// packages/api/src/repositories/admin.ts
// Admin console read models (A3.7 / driver roster). Parameterised SQL only (06 §2). The roster is a
// join of `app.users` (DRIVER role) with their current (non-revoked) `app.driver_devices` aggregated
// as a JSON array so the mobile `DriverSummary` shape is produced in one query. Driver status comes
// from `app.drivers`.

import { BaseRepository } from "@fleet/db";
import type { DbClient, DriverDeviceRow, UserRow } from "@fleet/shared";

export interface DriverRosterRow {
  user: UserRow;
  driverStatus: string | null;
  devices: DriverDeviceRow[];
}

export interface ListDriversOptions {
  /** Filter by account status. `ACTIVE` → is_active; `SUSPENDED` → NOT is_active. */
  status?: "ACTIVE" | "SUSPENDED";
  /** Keyset cursor: { sort: full_name, id }. */
  cursor?: { sort: string; id: string } | null;
  limit: number;
}

export class AdminRepository extends BaseRepository<UserRow> {
  constructor(client: DbClient) {
    super(client, "app.users");
  }

  async listDrivers(opts: ListDriversOptions): Promise<DriverRosterRow[]> {
    const where: string[] = ["ur.role_code = 'DRIVER'", "u.deleted_at IS NULL"];
    const params: unknown[] = [];

    if (opts.status === "ACTIVE") {
      where.push("u.is_active = true");
    } else if (opts.status === "SUSPENDED") {
      where.push("u.is_active = false");
    }

    if (opts.cursor) {
      where.push(
        "(u.full_name > $" +
          (params.push(opts.cursor.sort), params.length) +
          " OR (u.full_name = $" +
          (params.push(opts.cursor.sort), params.length) +
          " AND u.id > $" +
          (params.push(opts.cursor.id), params.length) +
          "))",
      );
    }

    const sql = `
      SELECT u.*, dr.status AS driver_status, COALESCE(
        (SELECT jsonb_agg(d.* ORDER BY d.created_at DESC)
           FROM app.driver_devices d
          WHERE d.user_id = u.id AND d.revoked_at IS NULL), '[]') AS devices
        FROM app.users u
        JOIN app.user_roles ur ON ur.user_id = u.id
        LEFT JOIN app.drivers dr ON dr.user_id = u.id AND dr.deleted_at IS NULL
       WHERE ${where.join(" AND ")}
       ORDER BY u.full_name ASC, u.id ASC
       LIMIT $${(params.push(opts.limit + 1), params.length)}`;

    const res = await this.client.query<DriverRosterRow>(sql, params);
    return res.rows;
  }
}
