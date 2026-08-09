// packages/api/src/repositories/maintenance.ts
// Maintenance repository (08_safety.sql). `app.maintenance_records` is an append-only completion
// log, so the soft-delete column is disabled explicitly (06 §3.1.2). Parameterised SQL only; the
// read model below is joined to the task catalogue and to whichever asset (vehicle or trailer) the
// record is attached to, and its aliases match the DTO field names exactly.

import { BaseRepository } from "@fleet/db";
import type { DbClient, MaintenanceRecordRow, MaintenanceTaskRow } from "@fleet/shared";

/** List/detail read model for `GET /maintenance` and `GET /maintenance/{id}`. */
export interface MaintenanceListRow {
  id: string;
  vehicle_plate: string | null;
  task_name: string;
  performed_at: string;
  odometer_km: number | null;
  cost: string | null;
  vendor: string | null;
}

// The plate is resolved from either asset; `app.maintenance_records` carries exactly one of
// vehicle_id / trailer_id (maintenance_records_exactly_one_asset), so COALESCE is unambiguous.
const MAINTENANCE_SELECT_SQL = `
       m.id                                  AS id,
       COALESCE(v.license_plate, t.license_plate) AS vehicle_plate,
       mt.name                               AS task_name,
       m.performed_at                        AS performed_at,
       m.odometer_km                         AS odometer_km,
       m.cost                                AS cost,
       m.vendor                              AS vendor`;

const MAINTENANCE_JOINS_SQL = `
       FROM app.maintenance_records m
       JOIN app.maintenance_tasks mt ON mt.id = m.task_id
       LEFT JOIN app.vehicles v ON v.id = m.vehicle_id
       LEFT JOIN app.trailers t ON t.id = m.trailer_id`;

export class MaintenanceRecordRepository extends BaseRepository<MaintenanceRecordRow> {
  constructor(client: DbClient) {
    super(client, "app.maintenance_records", { deletedAtColumn: null });
  }

  /** Keyset page on (performed_at, id) DESC. Fetches limit + 1 so `has_more` needs no COUNT. */
  async listRecords(opts: { limit: number; cursorSort?: string; cursorId?: string }): Promise<MaintenanceListRow[]> {
    const params: unknown[] = [];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `WHERE (m.performed_at, m.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<MaintenanceListRow>(
      `SELECT ${MAINTENANCE_SELECT_SQL}
       ${MAINTENANCE_JOINS_SQL}
       ${keyset}
        ORDER BY m.performed_at DESC, m.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Single record in the same projection as the list. */
  async findRecord(id: string): Promise<MaintenanceListRow | null> {
    const res = await this.client.query<MaintenanceListRow>(
      `SELECT ${MAINTENANCE_SELECT_SQL}
       ${MAINTENANCE_JOINS_SQL}
        WHERE m.id = $1::uuid
        LIMIT 1`,
      [id],
    );
    return res.rows[0] ?? null;
  }
}

export class MaintenanceTaskRepository extends BaseRepository<MaintenanceTaskRow> {
  constructor(client: DbClient) {
    super(client, "app.maintenance_tasks", { deletedAtColumn: null });
  }

  /** Resolves the catalogue task a work order refers to. Only active tasks are bookable. */
  async findActiveByCode(code: string): Promise<MaintenanceTaskRow | null> {
    const res = await this.client.query<MaintenanceTaskRow>(
      `SELECT * FROM app.maintenance_tasks WHERE code = $1::text AND is_active = true LIMIT 1`,
      [code],
    );
    return res.rows[0] ?? null;
  }
}
