// packages/shared/src/schemas/vehicleIssue.ts
import { z } from "zod";

export const VehicleIssueCategorySchema = z.enum(["MECHANICAL", "ELECTRICAL", "TYRE", "BODY", "OTHER"]);
export type VehicleIssueCategoryInput = z.infer<typeof VehicleIssueCategorySchema>;

export const VehicleIssueSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type VehicleIssueSeverityInput = z.infer<typeof VehicleIssueSeveritySchema>;

/** `POST /vehicles/{vehicleId}/issues` body — driver defect report (spec `report_vehicle_issue`). */
export const VehicleIssueCreateSchema = z.object({
  category: VehicleIssueCategorySchema,
  severity: VehicleIssueSeveritySchema,
  description: z.string().min(1).max(2000),
  shift_id: z.string().uuid().nullable().optional(),
  photo_media_object_id: z.string().uuid().nullable().optional(),
});
export type VehicleIssueCreateInput = z.infer<typeof VehicleIssueCreateSchema>;
