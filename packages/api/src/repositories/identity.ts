// packages/api/src/repositories/identity.ts
// Identity repositories (02-auth.md). Parameterised SQL only; no business rules (06 §2).
// Soft delete is honoured on master rows (users, drivers) — D3.

import { BaseRepository } from "@fleet/db";
import type {
  DbClient,
  DriverDeviceRow,
  DriverRow,
  MfaRecoveryCodeRow,
  PermissionCode,
  RoleCode,
  UserConsentRow,
  UserRow,
  UserSessionRow,
  ConsentType,
} from "@fleet/shared";

export class UserRepository extends BaseRepository<UserRow> {
  constructor(client: DbClient) {
    super(client, "app.users");
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const res = await this.client.query<UserRow>(
      `SELECT * FROM app.users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Drivers authenticate by phone (02-auth.md §2); admins by email. Phone numbers are stored as
   * entered, so the lookup normalises both sides to digits to make `+254700000000`,
   * `254700000000` and `0700 000 000`-style variants resolve to the same account.
   */
  async findByPhone(phone: string): Promise<UserRow | null> {
    const digits = phone.replace(/\D/g, "");
    if (!digits) return null;
    const res = await this.client.query<UserRow>(
      `SELECT * FROM app.users
        WHERE phone IS NOT NULL
          AND regexp_replace(phone, '\\D', '', 'g') = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [digits],
    );
    return res.rows[0] ?? null;
  }

  async recordFailedLogin(userId: string, lockedUntil: Date | null): Promise<number> {
    const res = await this.client.query<{ failed_login_count: number }>(
      `UPDATE app.users
          SET failed_login_count = failed_login_count + 1,
              locked_until = COALESCE($2, locked_until)
        WHERE id = $1
        RETURNING failed_login_count`,
      [userId, lockedUntil],
    );
    return res.rows[0]?.failed_login_count ?? 0;
  }

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await this.client.query(
      `UPDATE app.users
          SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
        WHERE id = $1`,
      [userId],
    );
  }

  async setLockout(userId: string, lockedUntil: Date | null): Promise<void> {
    await this.client.query(
      `UPDATE app.users SET locked_until = $2 WHERE id = $1`,
      [userId, lockedUntil],
    );
  }

  async stageMfaSecret(userId: string, secret: Buffer): Promise<void> {
    await this.client.query(
      `UPDATE app.users SET mfa_secret_encrypted = $2 WHERE id = $1`,
      [userId, secret],
    );
  }

  async activateMfa(userId: string): Promise<void> {
    await this.client.query(
      `UPDATE app.users SET mfa_enabled = true, mfa_enrolled_at = now() WHERE id = $1`,
      [userId],
    );
  }

  /**
   * Inserts a live user and its role grants (A3.7 self-service admin signup). Runs inside the
   * caller's transaction (D8) so the user row and its role rows commit together — a user with no
   * role would otherwise resolve to an empty permission union.
   *
   * `granted_by` is self-referential: a self-service signup has no other actor.
   */
  async createWithRoles(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string | null;
    roles: RoleCode[];
  }): Promise<UserRow> {
    const res = await this.client.query<UserRow>(
      `INSERT INTO app.users (email, password_hash, full_name, phone, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [input.email, input.passwordHash, input.fullName, input.phone ?? null],
    );
    const user = res.rows[0] as UserRow;

    for (const role of input.roles) {
      await this.client.query(
        `INSERT INTO app.user_roles (user_id, role_code, granted_by)
         VALUES ($1, $2, $1)
         ON CONFLICT (user_id, role_code) DO NOTHING`,
        [user.id, role],
      );
    }
    return user;
  }
}

export interface ResolvedPermissions {
  roles: RoleCode[];
  permissions: PermissionCode[];
  requiresMfa: boolean;
}

export class PermissionRepository {
  constructor(private readonly client: DbClient) {}

  /** Union of every role's grants (N4 / C6.2). No primary role. */
  async resolve(userId: string): Promise<ResolvedPermissions> {
    const res = await this.client.query<{
      role_code: RoleCode;
      requires_mfa: boolean;
      permission_code: PermissionCode | null;
    }>(
      `SELECT ur.role_code, r.requires_mfa, rp.permission_code
         FROM app.user_roles ur
         JOIN app.roles r ON r.code = ur.role_code
         LEFT JOIN app.role_permissions rp ON rp.role_code = ur.role_code
        WHERE ur.user_id = $1`,
      [userId],
    );

    const roles = new Set<RoleCode>();
    const permissions = new Set<PermissionCode>();
    let requiresMfa = false;
    for (const row of res.rows) {
      roles.add(row.role_code);
      if (row.requires_mfa) requiresMfa = true;
      if (row.permission_code) permissions.add(row.permission_code);
    }
    return { roles: [...roles], permissions: [...permissions].sort(), requiresMfa };
  }
}

export class DriverRepository extends BaseRepository<DriverRow> {
  constructor(client: DbClient) {
    super(client, "app.drivers");
  }

  async findByUserId(userId: string): Promise<DriverRow | null> {
    const res = await this.client.query<DriverRow>(
      `SELECT * FROM app.drivers WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Alias of findByUserId matching the `getBy…` naming used by the newer repositories
   * (onboarding). Kept as a thin delegate so both call sites share one query.
   */
  async getByUserId(userId: string): Promise<DriverRow | null> {
    return this.findByUserId(userId);
  }

  /** Returns only the driver ids that belong to the tenant; the rest are dropped (IDOR guard). */
  async resolveIdsInTenant(tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.drivers
         WHERE id = ANY($2::uuid[]) AND tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId, ids],
    );
    return res.rows.map((r) => r.id);
  }
}

export class SessionRepository extends BaseRepository<UserSessionRow> {
  constructor(client: DbClient) {
    super(client, "app.user_sessions", { deletedAtColumn: null });
  }

  async create(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<UserSessionRow> {
    const res = await this.client.query<UserSessionRow>(
      `INSERT INTO app.user_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.userId, input.refreshTokenHash, input.expiresAt, input.ipAddress ?? null, input.userAgent ?? null],
    );
    return res.rows[0] as UserSessionRow;
  }

  async findActiveByTokenHash(tokenHash: string): Promise<UserSessionRow | null> {
    const res = await this.client.query<UserSessionRow>(
      `SELECT * FROM app.user_sessions
        WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [tokenHash],
    );
    return res.rows[0] ?? null;
  }

  async rotate(sessionId: string, refreshTokenHash: string, expiresAt: Date): Promise<void> {
    await this.client.query(
      `UPDATE app.user_sessions
          SET refresh_token_hash = $2, expires_at = $3, last_seen_at = now()
        WHERE id = $1`,
      [sessionId, refreshTokenHash, expiresAt],
    );
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.client.query(
      `UPDATE app.user_sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }

  async revokeAllForUser(userId: string, reason: string): Promise<string[]> {
    const res = await this.client.query<{ id: string }>(
      `UPDATE app.user_sessions
          SET revoked_at = now(), revoked_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [userId, reason],
    );
    return res.rows.map((r) => r.id);
  }

  /** Live sessions, oldest first — the eviction order for the 10-session cap (A1.6). */
  async listActive(userId: string): Promise<UserSessionRow[]> {
    const res = await this.client.query<UserSessionRow>(
      `SELECT * FROM app.user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY issued_at ASC`,
      [userId],
    );
    return res.rows;
  }
}

export class DriverDeviceRepository extends BaseRepository<DriverDeviceRow> {
  constructor(client: DbClient) {
    super(client, "app.driver_devices", { deletedAtColumn: null });
  }

  async findLive(userId: string, deviceIdHash: string): Promise<DriverDeviceRow | null> {
    const res = await this.client.query<DriverDeviceRow>(
      `SELECT * FROM app.driver_devices
        WHERE user_id = $1 AND device_id_hash = $2 AND revoked_at IS NULL
        LIMIT 1`,
      [userId, deviceIdHash],
    );
    return res.rows[0] ?? null;
  }

  async findAnyByHash(deviceIdHash: string): Promise<DriverDeviceRow | null> {
    const res = await this.client.query<DriverDeviceRow>(
      `SELECT * FROM app.driver_devices
        WHERE device_id_hash = $1
        ORDER BY revoked_at NULLS FIRST, created_at DESC
        LIMIT 1`,
      [deviceIdHash],
    );
    return res.rows[0] ?? null;
  }

  async register(input: {
    userId: string;
    deviceIdHash: string;
    deviceLabel?: string | null;
    deviceModel?: string | null;
    osVersion?: string | null;
    appVersion?: string | null;
    pushToken?: string | null;
  }): Promise<DriverDeviceRow> {
    const res = await this.client.query<DriverDeviceRow>(
      `INSERT INTO app.driver_devices
         (user_id, device_id_hash, device_label, device_model, os_version, app_version,
          push_token, push_token_updated_at, last_seen_online_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IS NULL THEN NULL ELSE now() END, now())
       ON CONFLICT (user_id, device_id_hash) WHERE revoked_at IS NULL DO UPDATE
         SET device_label = COALESCE(EXCLUDED.device_label, app.driver_devices.device_label),
             device_model = COALESCE(EXCLUDED.device_model, app.driver_devices.device_model),
             os_version   = COALESCE(EXCLUDED.os_version,   app.driver_devices.os_version),
             app_version  = COALESCE(EXCLUDED.app_version,  app.driver_devices.app_version),
             push_token   = COALESCE(EXCLUDED.push_token,   app.driver_devices.push_token),
             push_token_updated_at = CASE WHEN EXCLUDED.push_token IS NULL
                                          THEN app.driver_devices.push_token_updated_at ELSE now() END,
             last_seen_online_at = now()
       RETURNING *`,
      [
        input.userId,
        input.deviceIdHash,
        input.deviceLabel ?? null,
        input.deviceModel ?? null,
        input.osVersion ?? null,
        input.appVersion ?? null,
        input.pushToken ?? null,
      ],
    );
    return res.rows[0] as DriverDeviceRow;
  }

  /** B12: only the fact that a PIN exists is stored; the bcrypt hash never leaves the device. */
  async markPinSet(deviceId: string): Promise<void> {
    await this.client.query(
      `UPDATE app.driver_devices
          SET pin_set_at = now(), offline_pin_failures = 0, offline_locked_until = NULL
        WHERE id = $1`,
      [deviceId],
    );
  }

  async bindRefreshToken(input: {
    deviceId: string;
    refreshTokenHash: string;
    refreshExpiresAt: Date;
    offlineWindowExpiresAt: Date;
  }): Promise<void> {
    await this.client.query(
      `UPDATE app.driver_devices
          SET refresh_token_hash = $2,
              refresh_token_expires_at = $3,
              offline_window_expires_at = $4,
              last_seen_online_at = now()
        WHERE id = $1`,
      [input.deviceId, input.refreshTokenHash, input.refreshExpiresAt, input.offlineWindowExpiresAt],
    );
  }

  async revoke(deviceId: string, reason: string, by: string): Promise<void> {
    await this.client.query(
      `UPDATE app.driver_devices
          SET revoked_at = now(), revoked_reason = $2, revoked_by = $3,
              refresh_token_hash = NULL, refresh_token_expires_at = NULL,
              offline_window_expires_at = NULL
        WHERE id = $1 AND revoked_at IS NULL`,
      [deviceId, reason, by],
    );
  }

  /** M4 mirror of the on-device counters: 5 failures → 15 min lock, 10 → local PIN wipe. */
  async recordOfflinePinOutcome(input: {
    deviceId: string;
    failures: number;
    lockedUntil: Date | null;
    pinWiped: boolean;
  }): Promise<void> {
    await this.client.query(
      `UPDATE app.driver_devices
          SET offline_pin_failures = $2,
              offline_locked_until = $3,
              pin_set_at = CASE WHEN $4 THEN NULL ELSE pin_set_at END,
              last_seen_online_at = now()
        WHERE id = $1`,
      [input.deviceId, input.failures, input.lockedUntil, input.pinWiped],
    );
  }
}

export class ConsentRepository extends BaseRepository<UserConsentRow> {
  constructor(client: DbClient) {
    super(client, "app.user_consents", { deletedAtColumn: null });
  }

  async findAccepted(userId: string, consentType: ConsentType): Promise<UserConsentRow | null> {
    const res = await this.client.query<UserConsentRow>(
      `SELECT * FROM app.user_consents
        WHERE user_id = $1 AND consent_type = $2 AND revoked_at IS NULL
        ORDER BY accepted_at DESC
        LIMIT 1`,
      [userId, consentType],
    );
    return res.rows[0] ?? null;
  }

  async accept(input: {
    userId: string;
    consentType: ConsentType;
    policyVersion: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    deviceIdHash?: string | null;
  }): Promise<UserConsentRow> {
    const res = await this.client.query<UserConsentRow>(
      `INSERT INTO app.user_consents
         (user_id, consent_type, policy_version, ip_address, user_agent, device_id_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, consent_type, policy_version) WHERE revoked_at IS NULL
         DO UPDATE SET accepted_at = app.user_consents.accepted_at
       RETURNING *`,
      [
        input.userId,
        input.consentType,
        input.policyVersion,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.deviceIdHash ?? null,
      ],
    );
    return res.rows[0] as UserConsentRow;
  }

  async revoke(userId: string, consentType: ConsentType): Promise<number> {
    const res = await this.client.query(
      `UPDATE app.user_consents
          SET revoked_at = now()
        WHERE user_id = $1 AND consent_type = $2 AND revoked_at IS NULL`,
      [userId, consentType],
    );
    return res.rowCount ?? 0;
  }
}

export class MfaRecoveryCodeRepository extends BaseRepository<MfaRecoveryCodeRow> {
  constructor(client: DbClient) {
    super(client, "app.mfa_recovery_codes", { deletedAtColumn: null });
  }

  async replaceAll(userId: string, codeHashes: string[]): Promise<void> {
    await this.client.query(
      `UPDATE app.mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    for (const hash of codeHashes) {
      await this.client.query(
        `INSERT INTO app.mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
        [userId, hash],
      );
    }
  }

  async consume(userId: string, codeHash: string): Promise<boolean> {
    const res = await this.client.query(
      `UPDATE app.mfa_recovery_codes
          SET used_at = now()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
      [userId, codeHash],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
