// packages/shared/src/schemas/driver.ts
// Driver-facing read-model response schemas exposed by the mobile backend (03 §2.2 / C1 / C3).
// These are the single source of truth the mobile client fetches; the client no longer derives or
// hard-codes these facts. Kept in @fleet/shared so the OpenAPI surface and the runtime validators
// cannot drift (09 §3).

import { z } from "zod";

/**
 * The driver's current dispatch assignment (A3). Backed by `app.assignments`; `starts_at` / `ends_at`
 * are `null` today because the assignment row only carries an operational `date` (A2.3) — the contract
 * leaves them nullable so a future time-bound assignment slots in without a breaking change.
 */
export const DriverAssignmentSchema = z.object({
  assignment_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable(),
  status: z.string(),
  starts_at: z.string().datetime().nullable(),
  ends_at: z.string().datetime().nullable(),
});
export type DriverAssignment = z.infer<typeof DriverAssignmentSchema>;

/** Consent gate status (C5.5). `consented` is the authoritative server fact; `required_version`
 *  is the policy version the backend currently requires (env). */
export const DriverConsentSchema = z.object({
  consented: z.boolean(),
  current_version: z.string().nullable(),
  required_version: z.string(),
});
export type DriverConsent = z.infer<typeof DriverConsentSchema>;

/** Training completion roll-up for the calling driver (C3). */
export const DriverTrainingStatusSchema = z.object({
  completed_lessons: z.array(z.string()),
  total_lessons: z.number().int().nonnegative(),
  all_complete: z.boolean(),
});
export type DriverTrainingStatus = z.infer<typeof DriverTrainingStatusSchema>;
