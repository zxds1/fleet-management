# Backend Design 02 — Authentication & Authorization

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md`,
`db/schema/02_identity.sql`, `db/seed/01_seed.sql`, `api/openapi.yaml`.

This document specifies identity: JWT lifecycle (A3.7), MFA/TOTP (A3.7), the role-permission
**union** model (N4/C6.2), the driver device + offline PIN path (B12/B13/M4), and the concurrent
session cap (A1.6).

---

## 1. Token model (A3.7)

| Token | Lifetime | Storage | Contents |
|---|---|---|---|
| **Access** (JWT HS256) | 15 min | memory only (never persisted) | `sub`, `email`, `roles[]`, `permissions[]`, `deviceIdHash?`, `sid`, `locale` |
| **Refresh** (opaque) | 7 days; **offline window 24 h** (B13) | hashed in `app.user_sessions` | `session_id`, `user_id`, `expires_at`, `offline_window_expires_at` |

- Access token is **stateless**; the embedded `permissions[]` is the precomputed union (§5) so
  request-time authz needs no DB lookup. Invalidating a session is done by revoking the refresh
  token (which also forces re-issue of access tokens at next refresh).
- The signing key is HS256 from the secret store. Key rotation: the verifier accepts the current
  and previous key (kid header) for a 24 h overlap.
- The access token is stamped into `audit_logs` as `actor_user_id` + `actor_role_codes` by the
  audit interceptor (`01` §4).

---

## 2. Login flow (sequence)

```
Driver/Admin  →  POST /auth/login {email, password[, mfa_code][, device_id_hash]}
  1. Verify email+password (argon2id verify against users.password_hash).
       fail → 401 UNAUTHENTICATED (increment users.failed_login_count; lock at threshold)
  2. If users.mfa_enabled → require mfa_code.
       missing → 401 MFA_REQUIRED
       wrong   → 401 UNAUTHENTICATED
  3. If user is a DRIVER:
       a. require device_id_hash; look up app.driver_devices.
          unknown → 403 DEVICE_UNKNOWN (must register device + set PIN first)
       b. if device.revoked_at IS NOT NULL → 403 DEVICE_REVOKED
       c. if driver.status = SUSPENDED → 403 ACCOUNT_SUSPENDED (B13)
       d. require an accepted GPS_TRACKING_WORKING_HOURS consent (app.user_consents,
          not revoked) → else 403 CONSENT_REQUIRED (C5.5)
  4. Enforce session cap (§6): if active sessions ≥ 10, evict oldest (A1.6).
  5. Create app.user_sessions row (refresh token hash, expires_at,
     offline_window_expires_at = now + 24h). Set users.last_login_at.
  6. Issue access + refresh tokens. Return {access_token, refresh_token, mfa_required:false,
     roles, permissions}.
```

The session cap and revocation checks are **authoritative** — they prevent a suspended driver
whose phone is offline from continuing to work (B13). When the offline driver eventually syncs,
step 3c aborts the login and the app shows *"Account suspended. Contact Admin."*

---

## 3. MFA / TOTP (A3.7)

- **Enrol:** `POST /auth/mfa/enroll` (Admin/Fleet Manager only). Verifies password, generates a
  TOTP secret, encrypts it (`users.mfa_secret_encrypted`, AES-GCM with a KMS data key — never
  returned in clear), builds a `otpauth://` provisioning URI, and generates **recovery codes**
  (stored hashed in `app.mfa_recovery_codes`). The secret is activated only after the user proves
  a first code (`mfa_enabled=true` on success). Recovery codes are shown **once**.
- **Verify:** standard TOTP (RFC 6238, 30 s step, 1-step skew). Wrong code counts toward
  `failed_login_count`.
- **Recovery:** `POST /auth/mfa/recover` exchanges a single recovery code for a short-lived
  bypass token; the code is marked `used_at` and cannot be reused.
- MFA is mandatory for `ADMIN` and `FLEET_MANAGER` (`roles.requires_mfa`); the login step 2 is the
  enforcement.

---

## 4. DeviceService — driver device + offline PIN (B12 / B13 / M4)

**Principle (B12):** the 4-digit PIN exists **only** as a bcrypt hash in the device keystore. The
server stores `device_id_hash` and a device-bound refresh token, never the PIN. This lets the
server revoke a device without ever knowing the PIN.

```ts
interface DeviceService {
  registerDevice(input: {
    userId: string; deviceIdHash: string; deviceLabel?; deviceModel?;
    osVersion?; appVersion?; pushToken?;  // FCM direct, N9
  }): Promise<DeviceRecord>;               // creates app.driver_devices row

  setPinLocal(userId: string, deviceIdHash: string, pinHashBcrypt: string): Promise<void>;
    // stores pin_set_at; the bcrypt hash is supplied by the device (server never sees plaintext)

  revokeDevice(userId: string, deviceIdHash: string, reason: string, by: string): Promise<void>;
    // sets revoked_at, invalidates the refresh token → 403 DEVICE_REVOKED on next sync (B13)

  recordOfflinePinOutcome(input: {
    deviceIdHash: string; success: boolean;
  }): Promise<void>;                        // syncs M4 counters: 5 fails→lock 15min, 10→wipe
}
```

Offline PIN brute-force protection (M4), enforced on-device but mirrored so the server can reason
about it:
- 5 failures → `offline_locked_until = now + 15 min` (device locks locally).
- 10 failures → device **wipes the local PIN hash** and forces an online re-login.
- The server stores `offline_pin_failures` / `offline_locked_until` for visibility; the actual
  gate is the device. This closes the "4-digit PIN brute-forceable" risk (design risk #9).

**Revocation reach:** `revokeDevice` invalidates `refresh_token_hash` in `app.driver_devices` **and**
the corresponding `app.user_sessions` row. An offline driver who exceeds the 24 h window
(`offline_window_expires_at`, B13) is forced online and, if suspended, is rejected.

---

## 5. PermissionService — the union model (N4 / C6.2)

A user may hold several roles (e.g. `FLEET_MANAGER + FINANCE`). Effective permissions are the
**union** of every role's `role_permissions`. There is **no primary role** (B16 superseded by N4).

```ts
interface PermissionService {
  resolve(userId: string): Promise<{
    roles: RoleCode[];
    permissions: PermissionCode[];     // union across roles
  }>;
  // Recomputed at login; cached on the session for fast middleware checks.
}
```

- `requirePermission(code: PermissionCode)` (middleware/guard) throws `Forbidden` when `code` is
  absent from `principal.permissions`.
- Role changes (grant/revoke via `role:manage`) take effect at the user's **next login** (the
  cached union in the current token is stale until refresh). An admin may force re-auth by
  revoking the user's sessions (`device:revoke` / session revoke).
- Permission codes are the seeded set in `db/seed/01_seed.sql` (e.g. `shift:verify`,
  `fuel:clear_payment`, `accident:acknowledge`). The code union in `shared` is **generated** from
  the seed so a missing grant is a compile error.
- **FINANCE** is the key union example: read-only over data plus the single write
  `fuel:clear_payment` (C6.1). The schema enforces `cleared_for_payment_at` requires
  `admin_verified=true`, so Finance cannot adjust figures, only clear them.

---

## 6. Concurrent session cap (A1.6)

- Max **10 live sessions per user**. Tracked in Redis: `user:{userId}:sessions` (sorted set,
  member = `session_id`, score = `expires_at`). `app.user_sessions` is the audit-backed source of
  truth.
- On new login (§2 step 4): if `ZCARD ≥ 10`, remove the lowest-scored (oldest) member, revoke that
  `user_sessions` row, and notify the user (security alert). Otherwise add.
- Refresh extends `expires_at` in both stores.
- Logout / `device:revoke` deletes the member + row.

---

## 7. Consent (C5.5)

- `GET /consent/required` returns the current `GPS_TRACKING_WORKING_HOURS` policy version.
- `POST /consent` records `app.user_consents` (accept) or `revoked_at` (withdraw). A driver with no
  accepted, unrevoked consent cannot start a shift (login step 3d). This is the technical half of
  the Kenya DPA 2019 consent requirement; the DPIA is the legal half (risk register R-101).

---

## 8. Endpoint surface (maps to `api/openapi.yaml`)

| Method/Path | Purpose | Permission | Notes |
|---|---|---|---|
| `POST /auth/login` | Authenticate (+MFA) | — | §2 |
| `POST /auth/refresh` | Rotate refresh→access | — | checks `user_sessions` active |
| `POST /auth/logout` | Revoke current session | authenticated | §6 |
| `POST /auth/mfa/enroll` | Begin TOTP enrol | self | Admin/FM via `roles.requires_mfa` |
| `POST /auth/mfa/recover` | Recovery code → bypass | — | one-time |
| `PUT /devices/{id}/pin` | Set local PIN hash | self (driver) | B12/M4 |
| `POST /devices/register` | Register device | authenticated | B12 |
| `GET /consent/required` | Current policy version | — | C5.5 |
| `POST /consent` | Accept/withdraw | authenticated | C5.5 |
| `POST /admin/users/{id}/revoke-sessions` | Force re-auth | `user:manage`/`device:revoke` | §5 |

---

## 9. Failure → error_code matrix (subset; full in `08`)

| Condition | HTTP | error_code |
|---|---|---|
| Bad credentials / wrong MFA | 401 | `UNAUTHENTICATED` / `MFA_REQUIRED` |
| Account locked (failed attempts) | 429 | `RATE_LIMITED` |
| Driver device unknown | 403 | `DEVICE_UNKNOWN` |
| Device revoked | 403 | `DEVICE_REVOKED` |
| Driver suspended | 403 | `ACCOUNT_SUSPENDED` |
| Missing GPS consent | 403 | `CONSENT_REQUIRED` |
| Lacks permission | 403 | `FORBIDDEN` |
| Session cap eviction race | 409 | `SESSION_LIMIT` |

---

## 10. Invariants this document locks

1. PIN never leaves the device; server stores only `device_id_hash` + device-bound refresh token.
2. Permissions are a union; no primary role; effective at next login.
3. A suspended/offline driver is rejected at next sync (24 h ceiling), not silently allowed.
4. Session cap is 10/user, enforced in Redis with `user_sessions` as the audit source.
5. MFA is mandatory for Admin/Fleet Manager and is enforced at login, not just enrolment.

`03` (REST API design) follows.
