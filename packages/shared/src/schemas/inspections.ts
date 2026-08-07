// packages/shared/src/schemas/inspections.ts
import { z } from "zod";

export const InspectionItemSchema = z.object({
  template_item_id: z.string().uuid(),
  result: z.enum(["PASS", "FAIL", "NOT_APPLICABLE"]),
  numeric_value: z.number().optional(),
  notes: z.string().max(2000).optional(),
  photo_media_object_id: z.string().uuid().optional(),
});
export type InspectionItemInput = z.infer<typeof InspectionItemSchema>;

export const InspectionSubmitSchema = z.object({
  shift_id: z.string().uuid(),
  template_id: z.string().uuid(),
  subject: z.enum(["VEHICLE", "TRAILER", "TRAILER_SWAP"]),
  vehicle_id: z.string().uuid().nullable().optional(),
  trailer_id: z.string().uuid().nullable().optional(),
  previous_defects_reviewed: z.boolean(),
  signature_name: z.string().min(1).max(200),
  items: z.array(InspectionItemSchema).min(1),
});
export type InspectionSubmitInput = z.infer<typeof InspectionSubmitSchema>;
