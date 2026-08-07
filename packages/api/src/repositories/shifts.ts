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
  TrailerRow,
  VehicleRow,
  WorkLogRow,
} from "@fleet/shared";

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
