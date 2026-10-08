import { z } from 'zod';

export const VehicleIssueCategorySchema = z.enum(['MECHANICAL', 'ELECTRICAL', 'TYRE', 'BODY', 'OTHER']);
export type VehicleIssueCategory = z.infer<typeof VehicleIssueCategorySchema>;

export const VehicleIssueSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type VehicleIssueSeverity = z.infer<typeof VehicleIssueSeveritySchema>;

export const VehicleIssueCreateSchema = z.object({
  category: VehicleIssueCategorySchema,
  severity: VehicleIssueSeveritySchema,
  description: z.string().min(1).max(2000),
  shift_id: z.string().uuid().nullable().optional(),
  photo_media_object_id: z.string().uuid().nullable().optional(),
});
export type VehicleIssueCreateInput = z.infer<typeof VehicleIssueCreateSchema>;

/** Response body of `POST /vehicles/{vehicleId}/issues`. */
export const VehicleIssueOutcomeSchema = z.object({
  issue_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  status: z.string(),
  severity: z.string(),
  created_at: z.string(),
});
export type VehicleIssueOutcome = z.infer<typeof VehicleIssueOutcomeSchema>;

/** One row of `GET /vehicles/{vehicleId}/issues` cursor page. */
export const VehicleIssueListRowSchema = z.object({
  id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  vehicle_plate: z.string().nullable(),
  category: z.string(),
  severity: z.string(),
  status: z.string(),
  description: z.string(),
  photo_media_object_id: z.string().nullable(),
  reported_by_driver_id: z.string().uuid(),
  reported_by_name: z.string().nullable(),
  created_at: z.string(),
});
export type VehicleIssueListRow = z.infer<typeof VehicleIssueListRowSchema>;
