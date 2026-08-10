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

  /**
   * Replaces the set of drivers dispatched to one vehicle for the current operational date
   * (`POST /vehicles/{id}/assign`). `assigned_date` is the Kenyan operational date (A2.3), which is
   * also what `assignments_vehicle_date_unique` / `assignments_driver_date_unique` are keyed on.
   *
   * Superseding is done by CANCELLING rather than deleting, so the dispatch history stays intact
   * and the partial unique indexes (which exclude CANCELLED) leave room for the new rows.
   */
  async replaceDriversForVehicle(input: {
    tenantId: string;
    vehicleId: string;
    driverIds: string[];
    createdBy: string;
  }): Promise<void> {
    await this.client.query(
      `UPDATE app.assignments
          SET status = 'CANCELLED',
              cancelled_by = $4,
              cancelled_at = now(),
              cancel_reason = 'Superseded by vehicle assignment',
              updated_at = now()
        WHERE tenant_id = $1
          AND vehicle_id = $2
          AND assigned_date = current_date
          AND status <> 'CANCELLED'
          AND NOT (driver_id = ANY($3::uuid[]))`,
      [input.tenantId, input.vehicleId, input.driverIds, input.createdBy],
    );
    if (input.driverIds.length === 0) return;

    // `assignments_driver_date_unique` means a driver can hold only one live assignment per date,
    // so an existing row for another vehicle is stood down before this one is written.
    await this.client.query(
      `UPDATE app.assignments
          SET status = 'CANCELLED',
              cancelled_by = $4,
              cancelled_at = now(),
              cancel_reason = 'Reassigned to another vehicle',
              updated_at = now()
        WHERE tenant_id = $1
          AND driver_id = ANY($3::uuid[])
          AND vehicle_id <> $2
          AND assigned_date = current_date
          AND status <> 'CANCELLED'`,
      [input.tenantId, input.vehicleId, input.driverIds, input.createdBy],
    );

    // The driver subquery is tenant-filtered, so an id from another tenant cannot create a row.
    await this.client.query(
      `INSERT INTO app.assignments (tenant_id, assigned_date, driver_id, vehicle_id, status, created_by)
       SELECT $1, current_date, d.id, $2, 'PLANNED', $4
         FROM app.drivers d
        WHERE d.id = ANY($3::uuid[]) AND d.tenant_id = $1 AND d.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM app.assignments a
             WHERE a.tenant_id = $1 AND a.driver_id = d.id
               AND a.assigned_date = current_date AND a.status <> 'CANCELLED'
          )`,
      [input.tenantId, input.vehicleId, input.driverIds, input.createdBy],
    );
  }

  /** Live (non-cancelled) driver ids dispatched to one vehicle today. */
  async listDriverIdsForVehicle(tenantId: string, vehicleId: string): Promise<string[]> {
    const res = await this.client.query<{ driver_id: string }>(
      `SELECT driver_id FROM app.assignments
        WHERE tenant_id = $1 AND vehicle_id = $2
          AND assigned_date = current_date AND status <> 'CANCELLED'
        ORDER BY created_at ASC`,
      [tenantId, vehicleId],
    );
    return res.rows.map((r) => r.driver_id);
  }
}

export class VehicleRepository extends BaseRepository<VehicleRow> {
  constructor(client: DbClient) {
    super(client, "app.vehicles");
  }

  /**
   * Tenant page for `GET /vehicles`, newest first with `id` as the tie-breaker so the keyset cursor
   * is total. Callers ask for `limit + 1` rows so `has_more` needs no count query (D7).
   *
   * `tenant_id` is repeated explicitly even though RLS already constrains the rows: if a connection
   * is ever borrowed without the GUC applied, the query still cannot cross a tenant boundary.
   */
  async listByTenant(input: {
    tenantId: string;
    limit: number;
    cursor?: { sort: string; id: string } | null;
  }): Promise<VehicleRow[]> {
    const cursor = input.cursor ?? null;
    const res = await this.client.query<VehicleRow>(
      `SELECT * FROM app.vehicles
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $4`,
      [input.tenantId, cursor?.sort ?? null, cursor?.id ?? null, input.limit],
    );
    return res.rows;
  }

  /** Single vehicle inside one tenant. Returns null rather than leaking another tenant's row. */
  async findByIdForTenant(tenantId: string, vehicleId: string): Promise<VehicleRow | null> {
    const res = await this.client.query<VehicleRow>(
      `SELECT * FROM app.vehicles
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [vehicleId, tenantId],
    );
    return res.rows[0] ?? null;
  }

  /** Live plate lookup backing the per-tenant uniqueness pre-check (`vehicles_tenant_plate_unique`). */
  async findByPlateForTenant(tenantId: string, licensePlate: string): Promise<VehicleRow | null> {
    const res = await this.client.query<VehicleRow>(
      `SELECT * FROM app.vehicles
        WHERE tenant_id = $1 AND license_plate = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, licensePlate],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Onboards a vehicle into one tenant (`POST /vehicles`). `tracker_imei` is deliberately left NULL
   * — pairing is the separate A1.1 flow — and the enum-typed columns fall back to their schema
   * defaults when the caller omits them.
   */
  async createForTenant(input: {
    tenantId: string;
    licensePlate: string;
    vehicleClass?: string | undefined;
    make?: string | undefined;
    model?: string | undefined;
    year?: number | undefined;
    ownershipType?: string | undefined;
    fuelTankCapacityLitres: number;
    notes?: string | undefined;
  }): Promise<VehicleRow> {
    const res = await this.client.query<VehicleRow>(
      `INSERT INTO app.vehicles
         (tenant_id, license_plate, vehicle_class, make, model, year, ownership_type,
          fuel_tank_capacity_litres, notes, tracker_imei, status, is_operational)
       VALUES ($1, $2,
               COALESCE($3, 'TRACTOR')::app.vehicle_class,
               $4, $5, $6,
               COALESCE($7, 'OWNED')::app.ownership_type,
               $8, $9, NULL, 'AVAILABLE'::app.asset_status, true)
       RETURNING *`,
      [
        input.tenantId,
        input.licensePlate,
        input.vehicleClass ?? null,
        input.make ?? null,
        input.model ?? null,
        input.year ?? null,
        input.ownershipType ?? null,
        input.fuelTankCapacityLitres,
        input.notes ?? null,
      ],
    );
    return res.rows[0] as VehicleRow;
  }

  /**
   * Patches the narrow set of columns the console may edit. Every key is optional: a NULL parameter
   * means "leave untouched", which keeps this a single statement instead of a dynamic UPDATE.
   */
  async updateForTenant(input: {
    tenantId: string;
    vehicleId: string;
    status?: string | undefined;
    isOperational?: boolean | undefined;
    notes?: string | null | undefined;
    nonOperationalReason?: string | null | undefined;
  }): Promise<VehicleRow | null> {
    const res = await this.client.query<VehicleRow>(
      `UPDATE app.vehicles
          SET status = COALESCE($3::app.asset_status, status),
              is_operational = COALESCE($4::boolean, is_operational),
              notes = CASE WHEN $5::boolean THEN $6::text ELSE notes END,
              non_operational_reason =
                CASE WHEN $7::boolean THEN $8::text ELSE non_operational_reason END,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING *`,
      [
        input.vehicleId,
        input.tenantId,
        input.status ?? null,
        input.isOperational ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.nonOperationalReason !== undefined,
        input.nonOperationalReason ?? null,
      ],
    );
    return res.rows[0] ?? null;
  }

  /** Ids from `ids` that exist inside this tenant. Used to reject cross-tenant assignment writes. */
  async filterIdsInTenant(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.vehicles
        WHERE id = ANY($2::uuid[]) AND tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    return res.rows.map((r) => r.id);
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


