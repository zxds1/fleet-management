// packages/shared/src/schemas/auth.ts
// Request validators mirroring api/openapi.yaml. The contract-test task fails the
// build if a schema diverges from the OpenAPI document (00-overview.md §5).

import { z } from "zod";

export const LoginSchema = z.object({
  // Drivers authenticate by phone; admins by email. Exactly one is required.
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
  password: z.string().min(1).max(200),
  mfa_code: z.string().regex(/^\d{6}$/).optional(),
  device_id_hash: z.string().min(16).optional(),
}).refine((v) => v.email || v.phone, { message: "Provide either email or phone" });
export type LoginInput = z.infer<typeof LoginSchema>;

export const MfaEnrollSchema = z.object({
  password: z.string().min(1).max(200),
});
export type MfaEnrollInput = z.infer<typeof MfaEnrollSchema>;

export const ConsentSchema = z.object({
  consent_type: z.enum(["GPS_TRACKING_WORKING_HOURS", "PHONE_GPS_FALLBACK", "DATA_PROCESSING_NOTICE"]),
  policy_version: z.string().min(1),
  accepted: z.boolean(),
});

/**
 * `POST /auth/devices/pin`. The PIN is a device-local secret that never transits the wire (B12);
 * the server only flips the `pin_set` flag. The body is therefore intentionally empty — this
 * schema exists so the route validates the request shape and the contract test stays honest.
 */
export const SetPinSchema = z.object({});

export const MediaUploadRequestSchema = z.object({
  owner_kind: z.enum([
    "WORK_LOG",
    "INSPECTION_ITEM",
    "FUEL_RECORD",
    "FUEL_PURCHASE",
    "EXPENSE",
    "ACCIDENT_REPORT",
    "ASSET_DOCUMENT",
    "TRAILER_ASSIGNMENT",
    "MAINTENANCE_RECORD",
    "QUARANTINE_EVENT",
    "STATEMENT_IMPORT",
  ]),
  retention_class: z.enum([
    "WORK_PLAN",
    "INSPECTION",
    "FUEL_RECEIPT",
    "FUEL_DASHBOARD",
    "EXPENSE_RECEIPT",
    "ACCIDENT",
    "ASSET_DOCUMENT",
    "MAINTENANCE",
    "STATEMENT_IMPORT",
    "TRAILER_SWAP",
  ]),
  content_type: z.string().regex(/^image\/(jpeg|png|webp)$/),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
  client_captured_at: z.string().datetime().optional(),
});
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;
