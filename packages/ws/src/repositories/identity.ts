// packages/ws/src/repositories/identity.ts
// Account + session status checks at connect time (07 §2). Parameterised SQL only (06 §2). Mirrors
// the suspend/revoke logic from 02-auth.md §4 so a suspended account or revoked device/session is
// rejected at the gateway with the SAME error_code the admin console branches on (08 §1).

import type { DbClient, DriverStatus } from "@fleet/shared";

export type AccountStatus =
  | "ok"
  | "ACCOUNT_SUSPENDED"
  | "DEVICE_REVOKED"
  | "SESSION_REVOKED";

export class AccountStatusRepository {
  constructor(private readonly client: DbClient) {}

  async check(
    userId: string,
    opts: { sessionId?: string; deviceIdHash?: string } = {},
  ): Promise<AccountStatus> {
    const res = await this.client.query<{
      is_active: boolean;
      locked_until: string | null;
      driver_status: DriverStatus | null;
      device_revoked_at: string | null;
      session_revoked_at: string | null;
    }>(
      `SELECT u.is_active,
              u.locked_until,
              d.status   AS driver_status,
              dd.revoked_at AS device_revoked_at,
              s.revoked_at AS session_revoked_at
         FROM app.users u
         LEFT JOIN app.drivers d ON d.user_id = u.id AND d.deleted_at IS NULL
         LEFT JOIN app.driver_devices dd ON dd.user_id = u.id AND dd.device_id_hash = COALESCE($2, '')
         LEFT JOIN app.user_sessions s ON s.id = $1
        WHERE u.id = $3 AND u.deleted_at IS NULL
        LIMIT 1`,
      [opts.sessionId ?? null, opts.deviceIdHash ?? null, userId],
    );

    const row = res.rows[0];
    if (!row) return "SESSION_REVOKED"; // unknown principal → not authenticated
    if (!row.is_active || (row.locked_until && new Date(row.locked_until) > new Date())) {
      return "ACCOUNT_SUSPENDED";
    }
    if (row.driver_status === "SUSPENDED") return "ACCOUNT_SUSPENDED";
    if (opts.deviceIdHash && row.device_revoked_at) return "DEVICE_REVOKED";
    if (opts.sessionId && row.session_revoked_at) return "SESSION_REVOKED";
    return "ok";
  }

  /** Active session ids, oldest first — the eviction order for the 10-session cap (A1.6). */
  async listActiveSessionIds(userId: string): Promise<string[]> {
    const res = await this.client.query<{ id: string }>(
      `SELECT id
         FROM app.user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY issued_at ASC`,
      [userId],
    );
    return res.rows.map((r) => r.id);
  }

  /** Durably revokes a session (the audit source for the 10-session cap eviction, 02 §6). */
  async revokeSession(userId: string, sessionId: string, reason: string): Promise<void> {
    await this.client.query(
      `UPDATE app.user_sessions
          SET revoked_at = now(), revoked_reason = $3
        WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`,
      [userId, sessionId, reason],
    );
  }
}
