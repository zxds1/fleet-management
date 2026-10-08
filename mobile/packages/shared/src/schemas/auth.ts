/**
 * Auth + device + consent wire shapes.
 *
 * Mirrors `fleet-management/packages/shared/src/schemas/auth.ts` for the request bodies and
 * `sessionBody()` in `packages/api/src/http/routes/auth.ts` for the responses. Note the two real
 * facts the earlier guesses got wrong: MFA is a delivered 6-digit OTP (not TOTP, so there is no
 * `provisioning_uri`), and device registration is an authenticated `POST /auth/devices` that runs
 * after login — login never returns `DEVICE_UNKNOWN`.
 */
import { z } from 'zod';
import { ConsentType, uuid } from '../types';
import { PermissionCode, RoleCode } from '../permissions';

// ── requests ────────────────────────────────────────────────────────────────────────────────

/** `POST /auth/login`. Drivers authenticate by phone, admins by email; exactly one is required. */
export const LoginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
    password: z.string().min(1).max(200),
    mfa_code: z.string().regex(/^\d{6}$/).optional(),
    device_id_hash: z.string().min(16).optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Provide either email or phone' });
export type LoginInput = z.infer<typeof LoginSchema>;

/** `POST /auth/mfa/verify`. The challenge token comes from the login response. */
export const MfaVerifySchema = z.object({
  mfa_challenge_token: z.string().min(1),
  /** A 6-digit OTP or a recovery code (4–16 chars); the server tries recovery codes first. */
  code: z.string().min(4).max(16),
});
export type MfaVerifyInput = z.infer<typeof MfaVerifySchema>;

/** `POST /auth/mfa/enroll`. Self-service only: there is no target-user form. */
export const MfaEnrollSchema = z.object({ password: z.string().min(1).max(200) });

/** `POST /consent`. */
export const ConsentSchema = z.object({
  consent_type: ConsentType,
  policy_version: z.string().min(1),
  accepted: z.boolean(),
});
export type ConsentInput = z.infer<typeof ConsentSchema>;

/**
 * `POST /auth/devices/pin`. The PIN is a device-local secret that never transits the wire (B12);
 * the server only flips the `pin_set` flag. The body is therefore intentionally empty.
 */
export const SetPinSchema = z.object({});

/** `POST /auth/devices`. */
export const DeviceRegisterSchema = z.object({
  device_id_hash: z.string().min(16),
  device_label: z.string().max(120).optional(),
  device_model: z.string().max(120).optional(),
  os_version: z.string().max(60).optional(),
  app_version: z.string().max(40).optional(),
  push_token: z.string().max(512).optional(),
});
export type DeviceRegisterInput = z.infer<typeof DeviceRegisterSchema>;

/** `POST /sessions/revoke`. Omit `user_id` to revoke the caller's own sessions. */
export const RevokeSessionsSchema = z.object({ user_id: z.string().uuid().nullable().optional() });

// ── responses ───────────────────────────────────────────────────────────────────────────────

/**
 * The session body returned by login, MFA verify and refresh. The identity fields are mirrored into
 * the response on purpose (C5.3): the client builds its Principal from this trusted body, never from
 * a decoded token.
 */
export const SessionResponseSchema = z.object({
  token_type: z.literal('Bearer'),
  access_token: z.string().min(1),
  access_token_expires_at: z.string().datetime(),
  refresh_token: z.string().min(1),
  refresh_token_expires_at: z.string().datetime(),
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(RoleCode),
  permissions: z.array(PermissionCode),
  locale: z.enum(['en', 'sw']),
  tenant_id: z.string().uuid().nullish(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** The MFA gate on login: no tokens yet, just the challenge token. */
export const MfaChallengeResponseSchema = z.object({
  mfa_required: z.literal(true),
  mfa_challenge_token: z.string().min(1),
});
export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponseSchema>;

/** `POST /auth/mfa/enroll` returns only the recovery codes; MFA is a delivered OTP, not a TOTP secret. */
export const MfaEnrollResponseSchema = z.object({ recovery_codes: z.array(z.string()).min(1) });
export type MfaEnrollResponse = z.infer<typeof MfaEnrollResponseSchema>;

/** `POST /auth/devices`. */
export const DeviceRegisterResponseSchema = z.object({
  device_id: z.string().uuid(),
  push_token: z.string().nullable().optional(),
});

/**
 * `POST /auth/devices/refresh` — the device-bound offline refresh token. `offline_until` is the
 * server's own 24 h offline ceiling (`auth.device_offline_max_hours`) and is authoritative.
 */
export const DeviceRefreshResponseSchema = z.object({
  refresh_token: z.string().min(1),
  expires_at: z.string().datetime(),
  offline_until: z.string().datetime(),
});
export type DeviceRefreshResponse = z.infer<typeof DeviceRefreshResponseSchema>;

/** `GET /me/consent` — the authoritative consent gate (C5.5). */
export const ConsentStatusSchema = z.object({
  consented: z.boolean(),
  current_version: z.string().nullable(),
  required_version: z.string().min(1),
});
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

/** `POST /consent` result. */
export const ConsentAcceptedSchema = z.object({ consent_id: z.string().uuid(), accepted: z.literal(true) });

/** `GET /drivers/me/assignment` (404 `NO_ASSIGNMENT` when the driver has none). */
export const DriverAssignmentSchema = z.object({
  assignment_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable(),
  status: z.string(),
  starts_at: z.string().datetime().nullable(),
  ends_at: z.string().datetime().nullable(),
});
export type DriverAssignment = z.infer<typeof DriverAssignmentSchema>;

/**
 * `GET /drivers/me/onboarding` (`OnboardingView`). Own-scoped, so this is the driver's own record and
 * it is the ONLY driver-readable source of a display name (U-06).
 */
export const DriverOnboardingSchema = z
  .object({
    id: z.string().uuid(),
    driver_id: z.string().uuid(),
    full_name: z.string().nullable(),
    licence_number: z.string().nullable(),
    licence_class: z.string().nullable(),
    emergency_contact_name: z.string().nullable(),
    emergency_contact_phone: z.string().nullable(),
    dob: z.string().nullable(),
    ssn_on_file: z.boolean(),
    background_check_status: z.string().nullable(),
    background_check_submitted_at: z.string().nullable(),
    background_check_cleared_at: z.string().nullable(),
    consent_given: z.boolean(),
    consent_at: z.string().nullable(),
    assigned_vehicle_id: z.string().uuid().nullable(),
    onboarding_complete: z.boolean(),
  })
  .passthrough();
export type DriverOnboarding = z.infer<typeof DriverOnboardingSchema>;

/** `GET /drivers/me/training-status`. */
export const DriverTrainingStatusSchema = z.object({
  completed_lessons: z.array(z.string()),
  total_lessons: z.number().int().nonnegative(),
  all_complete: z.boolean(),
});

/** `GET /drivers` row (admin roster, A3.7) — identical to openapi's `DriverSummary`. */
export const DriverSummarySchema = z.object({
  user_id: z.string().uuid(),
  email: z.string(),
  full_name: z.string().nullable(),
  mfa_enrolled: z.boolean(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']),
  last_login_at: z.string().nullable(),
  devices: z.array(
    z.object({
      device_id: z.string().uuid(),
      platform: z.enum(['ios', 'android']),
      last_seen_at: z.string().nullable(),
    }),
  ),
});
export type DriverSummary = z.infer<typeof DriverSummarySchema>;

/** `GET /drivers/{id}` = the roster row plus the RBAC union. */
export const DriverDetailSchema = DriverSummarySchema.extend({
  roles: z.array(RoleCode),
  permissions: z.array(PermissionCode),
});

/** `POST /auth/change-password`. */
export const ChangePasswordSchema = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().min(8).max(200) });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/** `POST /drivers/me/onboarding/profile`. */
export const SaveOnboardingProfileSchema = z.object({ full_name: z.string().min(1).max(120).optional(), licence_number: z.string().max(40).optional(), licence_class: z.string().max(20).optional(), emergency_contact_name: z.string().max(120).optional(), emergency_contact_phone: z.string().max(20).optional() });
export type SaveOnboardingProfileInput = z.infer<typeof SaveOnboardingProfileSchema>;

/** `POST /drivers/me/background-check`. */
export const SubmitBackgroundCheckSchema = z.object({ provider: z.string().min(1).max(80), consent_given: z.boolean() });
export type SubmitBackgroundCheckInput = z.infer<typeof SubmitBackgroundCheckSchema>;

/** `POST /drivers` (admin creates a driver record). */
export const CreateDriverSchema = z.object({ email: z.string().email(), full_name: z.string().min(1).max(120), password: z.string().min(8).max(200) });
export type CreateDriverInput = z.infer<typeof CreateDriverSchema>;

/** `POST /drivers/{id}/approve`. */
export const ApproveDriverSchema = z.object({ user_id: z.string().uuid() });
export type ApproveDriverInput = z.infer<typeof ApproveDriverSchema>;

/** `POST /auth/devices/revoke` (self-revoke). */
export const RevokeOwnDeviceSchema = z.object({ device_id: z.string().uuid() });
export type RevokeOwnDeviceInput = z.infer<typeof RevokeOwnDeviceSchema>;

/** `POST /admin/users/{id}/suspend` / `/reinstate`. */
export const UserStatusResponseSchema = z.object({ user_id: z.string().uuid(), status: z.enum(['ACTIVE', 'SUSPENDED']) });

/**
 * `GET /vehicles/{id}` (`VehicleRecord`). `asset:read` is a DRIVER permission, and
 * `current_odometer_km` / `current_odometer_at` are the vehicle's LAST ACCEPTED reading — which is
 * exactly what the DVIR / odometer pre-check needs (E-13). Note `GET /vehicles` returns a raw JSON
 * array of full rows, NOT a cursor page, so the app only ever uses the `/{id}` form.
 */
export const VehicleRecordSchema = z.object({
  id: z.string().uuid(),
  license_plate: z.string(),
  vehicle_class: z.string().nullable(),
  status: z.string().nullable(),
  is_operational: z.boolean().nullable(),
  non_operational_reason: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().nullable(),
  ownership_type: z.string().nullable(),
  current_odometer_km: z.number().nullable(),
  current_odometer_at: z.string().nullable(),
  engine_hours: z.number().nullable(),
  fuel_tank_capacity_litres: z.number().nullable(),
  notes: z.string().nullable(),
});
export type VehicleRecord = z.infer<typeof VehicleRecordSchema>;

export { uuid };