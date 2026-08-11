// packages/mobile/src/core/auth/schemas.ts
// Zod schemas for the auth surface (docs/backend/02-auth.md + api/openapi.yaml). These validate the
// *responses* the client trusts (C5.3: never trust raw bodies; parse before use) and describe the
// request shapes sent to the server.

import { z } from "zod";
import { BOOTSTRAP_TENANT_ID, type Principal } from "@fleet/shared/mobile";

/**
 * `POST /auth/login` (also accepts `mfa_code` on the second leg, A3.7). Drivers sign in with their
 * phone number; admins with email. Exactly one of `email`/`phone` is required.
 */
export const LoginRequestSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
    password: z.string(),
    mfa_code: z.string().optional(),
    device_id_hash: z.string().optional(),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: "Provide either an email or a phone number",
    path: ["email"],
  });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Login response. The openapi `200` lists `access_token/refresh_token/mfa_required/roles`; the
 * backend also returns `user_id` + `email`/`phone` and the effective `permissions` array (union
 * model, N4/C6.2). Drivers authenticate by phone and may have a null email; we parse defensively.
 */
export const LoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  mfa_required: z.boolean().optional(),
  user_id: z.string(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  locale: z.enum(["en", "sw"]).optional(),
  session_id: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** Builds a `Principal` from a validated login response (revives `permissions` as a Set). */
export function toPrincipal(res: LoginResponse): Principal {
  const roles = res.roles as Principal["roles"];
  const permissions = new Set(res.permissions) as Principal["permissions"];
  return {
    userId: res.user_id,
    email: res.email ?? "",
    phone: res.phone ?? undefined,
    roles,
    permissions,
    locale: res.locale ?? "en",
    sessionId: res.session_id,
    deviceIdHash: undefined,
    // The driver's tenant is resolved server-side and bound to the access token; the mobile client
    // does not choose it, so it mirrors the bootstrap/resolved tenant id from the trusted response.
    tenantId: res.tenant_id ?? BOOTSTRAP_TENANT_ID,
  };
}

/** `POST /auth/mfa/recover` → short-lived bypass token. */
export const MfaRecoverResponseSchema = z.object({ bypass_token: z.string() });
export type MfaRecoverResponse = z.infer<typeof MfaRecoverResponseSchema>;

/** `POST /auth/devices`. */
export const DeviceRegisterRequestSchema = z.object({
  device_id_hash: z.string(),
  device_label: z.string().optional(),
  device_model: z.string().optional(),
  os_version: z.string().optional(),
  app_version: z.string().optional(),
  push_token: z.string().optional(),
});
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequestSchema>;

export const DeviceRegisterResponseSchema = z.object({
  device_id: z.string(),
  push_token: z.string().nullable().optional(),
});
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponseSchema>;

/**
 * `POST /auth/consent` — mirrors `ConsentSchema` in `@fleet/shared` (the server records one row per
 * consent type). GPS tracking during working hours is the consent the app gates on (C5.5).
 */
export const ConsentRequestSchema = z.object({
  consent_type: z
    .enum(["GPS_TRACKING_WORKING_HOURS", "PHONE_GPS_FALLBACK", "DATA_PROCESSING_NOTICE"])
    .default("GPS_TRACKING_WORKING_HOURS"),
  policy_version: z.string().min(1),
  accepted: z.boolean(),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

export const ConsentResponseSchema = z.object({
  consent_id: z.string().optional(),
  accepted: z.boolean(),
});
export type ConsentResponse = z.infer<typeof ConsentResponseSchema>;

/** Server password policy minimum. Shared with the signup screen so the two cannot drift. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * `POST /auth/signup` — admin signup *with company creation*. The account and its company (tenant)
 * are provisioned in the same call, so `company_name` is required: a body without it would create an
 * admin with no tenant. `full_name` is optional (the backend falls back to the email local-part).
 *
 * The length check is a cheap client-side pre-filter so an obviously-invalid password never costs a
 * round-trip. It is NOT parity with the server's strength policy (complexity, breach lists, etc.) —
 * the server remains the sole authority and its rejection is what the user ultimately sees.
 */
export const AdminSignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  company_name: z.string().min(1).max(200),
  full_name: z.string().min(1).max(200).optional(),
  phone: z.string().max(40).optional(),
});
export type AdminSignupRequest = z.infer<typeof AdminSignupRequestSchema>;

/**
 * `POST /auth/signup` returns the same session body as `/auth/login` (201), not a bare account row:
 * the server signs the new admin straight in. Tokens are optional here because the flow re-logs-in
 * with the same credentials to honour the ADMIN MFA gate. `company_id`/`company_name` echo the
 * provisioned tenant.
 */
export const AdminSignupResponseSchema = z.object({
  user_id: z.string(),
  email: z.string().email().nullable().optional(),
  company_id: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  session_id: z.string().optional(),
  mfa_required: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  locale: z.enum(["en", "sw"]).optional(),
});
export type AdminSignupResponse = z.infer<typeof AdminSignupResponseSchema>;
