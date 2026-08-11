// packages/shared/src/schemas/privacy.ts
// Data Subject Access Request (DSAR) contract (15_privacy_requests.sql).
// GDPR Article 15 (right to access), Article 17 (right to erasure), and
// Article 20 (data portability); mirrored by Kenya DPA 2019 Part IV.
// Wire fields are snake_case to match api/openapi.yaml and app.privacy_requests.

import { z } from "zod";

export const PrivacyRequestTypeSchema = z.enum(["EXPORT", "DELETION"]);
export type PrivacyRequestTypeInput = z.infer<typeof PrivacyRequestTypeSchema>;

export const PrivacyRequestStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "READY",
  "DOWNLOADED",
  "COMPLETED",
  "FAILED",
]);
export type PrivacyRequestStatusInput = z.infer<typeof PrivacyRequestStatusSchema>;

/**
 * `POST /privacy/export-request` body. The driver may attach a free-form note
 * (e.g. "I want data for my tax return"); it is stored on the row for the reviewer.
 */
export const ExportRequestSchema = z
  .object({
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type ExportRequestInput = z.infer<typeof ExportRequestSchema>;

/**
 * `POST /privacy/deletion-request` body. A deletion request must include a
 * reason (the platform never hard-deletes, so a soft-delete justification is
 * retained on the privacy_requests row for audit, C5.5).
 */
export const DeletionRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .strict();
export type DeletionRequestInput = z.infer<typeof DeletionRequestSchema>;

/**
 * Projection of an `app.privacy_requests` row for the list + single endpoints.
 * `download_token` and `file_key` are intentionally absent — they are only
 * revealed via the authenticated download path.
 */
export const PrivacyRequestViewSchema = z.object({
  id: z.string().uuid(),
  request_type: PrivacyRequestTypeSchema,
  status: PrivacyRequestStatusSchema,
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});
export type PrivacyRequestView = z.infer<typeof PrivacyRequestViewSchema>;
