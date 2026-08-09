// packages/api/src/repositories/admin.ts
// Admin console read models (A3.7 / driver roster). Parameterised SQL only (06 §2). The roster is a
// join of `app.users` (DRIVER role) with their current (non-revoked) `app.driver_devices` aggregated
// as a JSON array so the mobile `DriverSummary` shape is produced in one query. Driver status comes
// from `app.drivers`.

import { BaseRepository } from "@fleet/db";
import type { DbClient, DriverDeviceRow, PermissionCode, RoleCode, UserRow } from "@fleet/shared";

export interface DriverRosterRow {
  user: UserRow;
  driverStatus: string | null;
  devices: DriverDeviceRow[];
}

/** Roster row plus the RBAC union (N4/C6.2) used by the admin driver-detail screen. */
export interface DriverDetailRow extends DriverRosterRow {
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface CreateDriverInput {
  email: string;
  fullName: string;
  phone?: string | null;
  /** Defaults to ['DRIVER'] at the service layer. */
  roles: RoleCode[];
  /** Argon2id hash. Invited users get an unusable placeholder until they set a password. */
  passwordHash: string;
  grantedBy: string;
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

  /**
   * Single driver with devices + the RBAC union. Permissions come from
   * app.role_permissions (app.roles holds no permission_code column).
   */
  async getDriver(userId: string): Promise<DriverDetailRow | null> {
    const res = await this.client.query<DriverDetailRow>(
      `SELECT u.*,
              COALESCE(
                (SELECT jsonb_agg(d.* ORDER BY d.created_at DESC)
                   FROM app.driver_devices d
                  WHERE d.user_id = u.id AND d.revoked_at IS NULL), '[]') AS devices,
              COALESCE(
                (SELECT jsonb_agg(DISTINCT ur.role_code)
                   FROM app.user_roles ur
                  WHERE ur.user_id = u.id), '[]') AS roles,
              COALESCE(
                (SELECT jsonb_agg(DISTINCT rp.permission_code)
                   FROM app.user_roles ur2
                   JOIN app.role_permissions rp ON rp.role_code = ur2.role_code
                  WHERE ur2.user_id = u.id), '[]') AS permissions
         FROM app.users u
        WHERE u.id = $1 AND u.deleted_at IS NULL
        LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /** Approve / reinstate: flips is_active, which is what the roster derives status from. */
  async setActive(userId: string, isActive: boolean): Promise<UserRow | null> {
    const res = await this.client.query<UserRow>(
      `UPDATE app.users
          SET is_active = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [userId, isActive],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Patches a user's own editable profile fields (`PUT /admin/users/me`). Only the three columns
   * the profile screen owns are writable; every other column (roles, is_active, password_hash) is
   * unreachable from here by construction. The SET list is built from a fixed literal map, never
   * from request keys, so the SQL stays identifier-free (00 §4 invariant 1).
   */
  async updateProfile(
    userId: string,
    input: { full_name?: string; phone?: string | null; locale?: string },
  ): Promise<UserRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [userId];
    if (input.full_name !== undefined) {
      params.push(input.full_name);
      sets.push(`full_name = $${params.length}`);
    }
    if (input.phone !== undefined) {
      params.push(input.phone);
      sets.push(`phone = $${params.length}`);
    }
    if (input.locale !== undefined) {
      params.push(input.locale);
      sets.push(`locale = $${params.length}`);
    }
    // Nothing to change: return the current row rather than emitting `SET` with an empty list.
    if (sets.length === 0) {
      const current = await this.client.query<UserRow>(
        `SELECT * FROM app.users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId],
      );
      return current.rows[0] ?? null;
    }
    const res = await this.client.query<UserRow>(
      `UPDATE app.users
          SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      params,
    );
    return res.rows[0] ?? null;
  }

  async findLiveByEmail(email: string): Promise<UserRow | null> {    const res = await this.client.query<UserRow>(
      `SELECT * FROM app.users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email],
    );
    return res.rows[0] ?? null;
  }

  /** One live user by id — backs `GET /admin/users/me` (the caller's own profile). */
  async findLiveById(userId: string): Promise<UserRow | null> {
    const res = await this.client.query<UserRow>(
      `SELECT * FROM app.users WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /** Inserts the user and its role grants; caller runs this inside the request transaction (D8). */
  async createDriver(input: CreateDriverInput): Promise<UserRow> {
    const res = await this.client.query<UserRow>(
      `INSERT INTO app.users (email, password_hash, full_name, phone, is_active)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [input.email, input.passwordHash, input.fullName, input.phone ?? null],
    );
    const user = res.rows[0] as UserRow;

    for (const role of input.roles) {
      await this.client.query(
        `INSERT INTO app.user_roles (user_id, role_code, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, role_code) DO NOTHING`,
        [user.id, role, input.grantedBy],
      );
    }
    return user;
  }
}
