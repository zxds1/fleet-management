// packages/shared/src/schemas/vehicleIssue.ts
// Driver-reported vehicle issue (defect) contract — the non-accident sibling of schemas/accidents.ts.
// Wire fields are snake_case to match api/openapi.yaml and app.vehicle_issues; the enums mirror the
// DB types app.vehicle_issue_category / _severity exactly so a rename is a compile error on both
// sides of the wire.
import { z } from "zod";

export const VehicleIssueCategorySchema = z.enum([
  "MECHANICAL",
  "ELECTRICAL",
  "TYRE",
  "BODY",
  "OTHER",
]);
export type VehicleIssueCategoryInput = z.infer<typeof VehicleIssueCategorySchema>;

export const VehicleIssueSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type VehicleIssueSeverityInput = z.infer<typeof VehicleIssueSeveritySchema>;

/**
 * Body of `POST /vehicles/{vehicleId}/issues`.
 *
 * `photo_media_object_id` is optional on purpose: a photo is encouraged but never mandatory, so a
 * driver can raise a brake fault they cannot safely photograph (contrast with DVIR FAIL items,
 * which the inspection service rejects without evidence).
 */
export const VehicleIssueCreateSchema = z.object({
  category: VehicleIssueCategorySchema,
  severity: VehicleIssueSeveritySchema.default("LOW"),
  description: z.string().min(1).max(2000),
  shift_id: z.string().uuid().nullable().optional(),
  photo_media_object_id: z.string().uuid().nullable().optional(),
});
export type VehicleIssueCreateInput = z.infer<typeof VehicleIssueCreateSchema>;
