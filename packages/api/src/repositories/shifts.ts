// packages/api/src/repositories/shifts.ts
// Shift + supporting repositories (05_operations.sql, 04_assets.sql, 07_financial.sql). Parameterised
// SQL only; no business rules (06 §2). Soft delete is honoured on master rows (D3).

import { BaseRepository } from "@fleet/db";
import type {
  AssignmentRow,
  DbClient,
  DriverHosStateRow,
  FuelRecordRow,
  ShiftRow,
  ShiftVerificationInboxViewRow,
  TrailerRow,
  WorkLogRow,
  VehicleRow,
} from "@fleet/shared";

/** Mobile/admin read model for a driver's own shift history (03 §2.2). */
export interface ShiftHistoryRow {
  shift_id: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_seconds: number | null;
  distance_km: string | null;
  state: ShiftRow["state"] | null;
  verification_status: ShiftRow["verification_status"] | null;
}

export class ShiftRepository extends BaseRepository<ShiftRow> {
  constructor(client: DbClient) {
    super(client, "app.shifts");
  }

  async findOpenByDriver(driverId: string): Promise<ShiftRow | null> {
    const res = await this.client.query<ShiftRow>(
      `SELECT * FROM app.shifts WHERE driver_id = $1 AND clock_out_at IS NULL LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }

  async findPendingCloseoutByDriver(driverId: string): Promise<ShiftRow | null> {
    const res = await this.client.query<ShiftRow>(
      `SELECT * FROM app.shifts WHERE driver_id = $1 AND state = 'PENDING_CLOSEOUT' LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }

  async listActiveByDriver(driverId: string): Promise<ShiftRow[]> {
    const res = await this.client.query<ShiftRow>(
      `SELECT * FROM app.shifts WHERE driver_id = $1 ORDER BY clock_in_at DESC LIMIT 20`,
      [driverId],
    );
    return res.rows;
  }

  /**
   * Driver-owned shift history, keyset paginated on (clock_in_at, id). Always scoped to the
   * caller's driver id so a driver can never read another driver's rows (06 §2).
   */
  async listHistoryByDriver(
    driverId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<ShiftHistoryRow[]> {
    const params: unknown[] = [driverId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (s.clock_in_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<ShiftHistoryRow>(
      `SELECT s.id                        AS shift_id,
              s.vehicle_id                AS vehicle_id,
              v.license_plate             AS vehicle_plate,
              s.clock_in_at               AS clock_in_at,
              s.clock_out_at              AS clock_out_at,
              s.shift_duration_seconds    AS duration_seconds,
              s.total_distance_km         AS distance_km,
              s.state                     AS state,
              s.verification_status       AS verification_status
         FROM app.shifts s
         LEFT JOIN app.vehicles v ON v.id = s.vehicle_id
        WHERE s.driver_id = $1 ${keyset}
        ORDER BY s.clock_in_at DESC, s.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Verification detail for a single shift (admin detail screen). */
  async getVerificationById(shiftId: string): Promise<ShiftVerificationInboxViewRow | null> {
    const res = await this.client.query<ShiftVerificationInboxViewRow>(
      `SELECT * FROM app.v_shift_verification_inbox WHERE shift_id = $1::uuid LIMIT 1`,
      [shiftId],
    );
    return res.rows[0] ?? null;
  }
}

export class AssignmentRepository extends BaseRepository<AssignmentRow> {
  constructor(client: DbClient) {
    super(client, "app.assignments", { deletedAtColumn: null });
  }
}

export class VehicleRepository extends BaseRepository<VehicleRow> {
  constructor(client: DbClient) {
    super(client, "app.vehicles");
  }
}

export class TrailerRepository extends BaseRepository<TrailerRow> {
  constructor(client: DbClient) {
    super(client, "app.trailers");
  }
}

export class WorkLogRepository extends BaseRepository<WorkLogRow> {
  constructor(client: DbClient) {
    super(client, "app.work_logs", { deletedAtColumn: null });
  }
}

export class FuelRecordRepository extends BaseRepository<FuelRecordRow> {
  constructor(client: DbClient) {
    super(client, "app.fuel_records", { deletedAtColumn: null });
  }
}

/** Reads the rolling HOS ledger (08 §4). `next_eligible_clock_in_at` drives the C3.3 block. */
export class HosRepository {
  constructor(private readonly client: DbClient) {}

  async getState(driverId: string): Promise<DriverHosStateRow | null> {
    const res = await this.client.query<DriverHosStateRow>(
      `SELECT * FROM app.driver_hos_state WHERE driver_id = $1 LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }
}
