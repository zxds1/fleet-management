// packages/shared/src/schemas/auth.ts
// Request validators mirroring api/openapi.yaml. The contract-test task fails the
// build if a schema diverges from the OpenAPI document (00-overview.md §5).

import { z } from "zod";

export const LoginSchema = z
  .object({
    // Drivers authenticate by phone; admins by email. Exactly one is required.
    email: z.string().email().optional(),
    phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
    password: z.string().min(1).max(200),
    mfa_code: z.string().regex(/^\d{6}$/).optional(),
    device_id_hash: z.string().min(16).optional(),
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: "Provide either email or phone" });
export type LoginInput = z.infer<typeof LoginSchema>;

export const MfaEnrollSchema = z
  .object({
    password: z.string().min(1).max(200),
  })
  .strict();
export type MfaEnrollInput = z.infer<typeof MfaEnrollSchema>;

export const ConsentSchema = z
  .object({
    consent_type: z.enum(["GPS_TRACKING_WORKING_HOURS", "PHONE_GPS_FALLBACK", "DATA_PROCESSING_NOTICE"]),
    policy_version: z.string().min(1),
    accepted: z.boolean(),
  })
  .strict();

/**
 * `POST /auth/devices/pin`. The PIN is a device-local secret that never transits the wire (B12);
 * the server only flips the `pin_set` flag. The body is therefore intentionally empty — this
 * schema exists so the route validates the request shape and the contract test stays honest.
 */
export const SetPinSchema = z.object({}).strict();

/**
 * The media presign body. Kept as an alias of the canonical `MediaUploadSchema` so the two can
 * never drift apart.
 */
export { MediaUploadSchema as MediaUploadRequestSchema, type MediaUploadInput as MediaUploadRequest } from "./media";
