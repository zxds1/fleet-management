// packages/api/src/services/maintenance.ts
// Maintenance service (Pillar 3, 08_safety.sql). Owns the work-order rules and returns Result<T>;
// it never throws for a domain rule (08 §1). Reads run on a pooled client and use keyset cursor
// pagination (D7); the write runs inside the request transaction and stages an outbox event so the
// worker can fan out the maintenance notification (D8).

import {
  type Result,
  type Tx,
  ok,
  err,
  NotFound,
  violation,
  conflict,
} from "@fleet/shared";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage, type CursorPage } from "../http/pagination";
import type {
  MaintenanceListRow,
  MaintenanceRecordRepository,
  MaintenanceTaskRepository,
} from "../repositories/maintenance";

export interface WorkOrderInput {
  vehicle_id?: string;
  trailer_id?: string;
  task_code: string;
  performed_at: string;
  odometer_km?: number;
  vendor?: string;
  cost?: number;
  currency?: string;
  notes?: string;
}

export class MaintenanceService {
  constructor(
    private readonly records: MaintenanceRecordRepository,
    private readonly tasks: MaintenanceTaskRepository,
  ) {}

  /** Cursor page of completed maintenance, newest first. Keyset on (performed_at, id) DESC. */
  async list(opts: { limit: number; cursor?: string | null }): Promise<Result<CursorPage<MaintenanceListRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.records.listRecords({
      limit: limit + 1,
      ...(cursor ? { cursorSort: cursor.sort, cursorId: cursor.id } : {}),
    });
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.performed_at ?? ""), id: row.id })));
  }

  /** Single maintenance record. Unknown id → NotFound (404) rather than an empty 200. */
  async getOne(id: string): Promise<Result<MaintenanceListRow>> {
    const row = await this.records.findRecord(id);
    if (!row) return err(new NotFound("Maintenance record not found"));
    return ok(row);
  }

  /**
   * Records a completed work order against exactly one asset. `app.maintenance_records` enforces
   * the same rule with maintenance_records_exactly_one_asset; checking it here turns a would-be
   * 500 constraint violation into a 422 the client can branch on (08 §1).
   */
  async createWorkOrder(
    tx: Tx,
    input: WorkOrderInput,
    actor: { userId: string },
  ): Promise<Result<{ id: string; task_id: string; performed_at: string }>> {
    const hasVehicle = Boolean(input.vehicle_id);
    const hasTrailer = Boolean(input.trailer_id);
    if (hasVehicle === hasTrailer) {
      return err(
        violation(
          "MAINTENANCE_ASSET_REQUIRED",
          "Exactly one asset required",
          "Provide exactly one of vehicle_id or trailer_id.",
        ),
      );
    }

    const task = await this.tasks.findActiveByCode(input.task_code);
    if (!task) {
      return err(
        conflict(
          "MAINTENANCE_TASK_UNKNOWN",
          "Unknown maintenance task",
          `No active maintenance task with code "${input.task_code}".`,
        ),
      );
    }

    // The catalogue task declares which asset kind it applies to; booking a VEHICLE task against a
    // trailer would silently produce a nonsensical schedule roll-forward.
    const appliesTo = hasVehicle ? "VEHICLE" : "TRAILER";
    if (task.applies_to !== appliesTo) {
      return err(
        violation(
          "MAINTENANCE_TASK_ASSET_MISMATCH",
          "Task does not apply to this asset",
          `Task "${task.code}" applies to ${task.applies_to}, not ${appliesTo}.`,
        ),
      );
    }

    const row = await this.records.insert({
      task_id: task.id,
      vehicle_id: input.vehicle_id ?? null,
      trailer_id: input.trailer_id ?? null,
      performed_at: input.performed_at,
      odometer_km: input.odometer_km ?? null,
      vendor: input.vendor ?? null,
      cost: input.cost != null ? String(input.cost) : null,
      ...(input.currency ? { currency: input.currency } : {}),
      notes: input.notes ?? null,
      recorded_by: actor.userId,
    });

    tx.registerOutbox({
      event_type: "maintenance.work_order.created",
      aggregate_type: "maintenance_record",
      aggregate_id: row.id,
      payload: {
        id: row.id,
        task_code: task.code,
        vehicle_id: input.vehicle_id ?? null,
        trailer_id: input.trailer_id ?? null,
        performed_at: row.performed_at,
      },
    });

    return ok({ id: row.id, task_id: task.id, performed_at: row.performed_at });
  }
}
