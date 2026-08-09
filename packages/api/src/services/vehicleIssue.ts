// packages/api/src/services/vehicleIssue.ts
// Driver-reported vehicle issues (14_vehicle_issues.sql). This is the non-accident defect path: it
// deliberately does NOT create an escalation timer (that is reserved for app.accident_reports and
// the B17 MAYDAY escape hatch, C6.3). Instead the report is staged on the outbox so the worker can
// notify the maintenance/on-call roster, and a HIGH severity report carries a flag the worker uses
// to page rather than digest.
//
// Every rule returns a Result with a frozen error_code (08 §1); the service never throws for a
// domain rule. Reads use keyset cursor pagination (D7).

import {
  err,
  ok,
  NotFound,
  violation,
  type Result,
  type Tx,
} from "@fleet/shared";
import type { VehicleIssueCreateInput } from "@fleet/shared";
import { buildPage, decodeCursor, MAX_PAGE_LIMIT, type CursorPage } from "../http/pagination";
import type { VehicleIssueListRow, VehicleIssueRepository } from "../repositories/vehicleIssue";

/** Response body of `POST /vehicles/{vehicleId}/issues`. */
export interface VehicleIssueOutcome {
  issue_id: string;
  vehicle_id: string;
  status: string;
  severity: string;
  created_at: string;
}

export class VehicleIssueService {
  constructor(private readonly issues: VehicleIssueRepository) {}

  /**
   * Records a driver-reported defect against a vehicle.
   *
   * The vehicle is resolved first so an unknown/soft-deleted asset yields a 404 instead of a raw FK
   * violation (which would surface as a 500). A blank description is rejected here as well as by
   * the DB CHECK so the client gets a branchable 422 rather than a constraint error.
   */
  async report(
    tx: Tx,
    vehicleId: string,
    driverId: string,
    input: VehicleIssueCreateInput,
  ): Promise<Result<VehicleIssueOutcome>> {
    const exists = await this.issues.vehicleExists(vehicleId);
    if (!exists) return err(new NotFound("Vehicle not found"));

    const description = input.description.trim();
    if (description.length === 0) {
      return err(
        violation(
          "VEHICLE_ISSUE_DESCRIPTION_REQUIRED",
          "Description required",
          "Describe the fault so maintenance can triage it.",
        ),
      );
    }

    const row = await this.issues.insert({
      vehicle_id: vehicleId,
      reported_by_driver_id: driverId,
      shift_id: input.shift_id ?? null,
      category: input.category,
      severity: input.severity,
      description,
      photo_media_object_id: input.photo_media_object_id ?? null,
      status: "OPEN",
    });

    // The worker fans this out to the maintenance inbox; `severity` lets it page on HIGH and digest
    // the rest (D8 — staged in the request transaction, relayed after COMMIT).
    tx.registerOutbox({
      event_type: "vehicle.issue.reported",
      aggregate_type: "vehicle_issue",
      aggregate_id: row.id,
      payload: {
        issue_id: row.id,
        vehicle_id: vehicleId,
        driver_id: driverId,
        category: row.category,
        severity: row.severity,
      },
    });

    return ok({
      issue_id: row.id,
      vehicle_id: row.vehicle_id,
      status: row.status,
      severity: row.severity,
      created_at: row.created_at,
    });
  }

  /** Cursor page of the issues raised against one vehicle, newest first. */
  async getForVehicle(
    vehicleId: string,
    opts: { limit: number; cursor?: string | null },
  ): Promise<Result<CursorPage<VehicleIssueListRow>>> {
    const exists = await this.issues.vehicleExists(vehicleId);
    if (!exists) return err(new NotFound("Vehicle not found"));

    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.issues.listByVehicle(vehicleId, {
      limit: limit + 1,
      ...(cursor ? { cursorSort: cursor.sort, cursorId: cursor.id } : {}),
    });
    // The cursor MUST key on the same column the repository orders by (`i.created_at`), otherwise
    // the next page comparison is evaluated against an unrelated timestamp.
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.created_at ?? ""), id: row.id })));
  }

  /** Single issue; unknown id → NotFound (404) rather than an empty 200. */
  async getOne(id: string): Promise<Result<VehicleIssueListRow>> {
    const row = await this.issues.findOne(id);
    if (!row) return err(new NotFound("Vehicle issue not found"));
    return ok(row);
  }
}
