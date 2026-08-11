// packages/shared/src/schemas/status.ts
// Response shapes for the driver/consent/training/notification status endpoints the mobile client
// fetches from the backend (contract: GET /drivers/me/assignment, GET /me/consent,
// GET /drivers/me/training-status, POST /notifications/{id}/read, POST /notifications/read-all).
// These must match the entries in api/openapi.yaml exactly (npm run contract enforces the
// @fleet/shared ↔ OpenAPI schema name match).

import { z } from "zod";

export const DriverAssignmentSchema = z.object({
  assignment_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable(),
  status: z.string(),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
});

export const ConsentStatusSchema = z.object({
  consented: z.boolean(),
  current_version: z.string().nullable(),
  required_version: z.string(),
});

export const TrainingStatusSchema = z.object({
  completed_lessons: z.array(z.string()),
  total_lessons: z.number().int(),
  all_complete: z.boolean(),
});
