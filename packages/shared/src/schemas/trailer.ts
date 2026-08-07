// packages/shared/src/schemas/trailer.ts
import { z } from "zod";

export const TrailerSwapSchema = z.object({
  shift_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid(),
  trailer_id: z.string().uuid().nullable().optional(),
  new_trailer_plate: z.string().min(1).max(20).optional(),
  new_trailer_type: z.enum(["DRY_VAN", "REEFER", "FLATBED", "LOWBOY", "TANKER", "CURTAIN_SIDE", "OTHER"]).optional(),
  hook_media_object_id: z.string().uuid(),
  hook_inspection_id: z.string().uuid(),
  drop_media_object_id: z.string().uuid().optional(),
});
export type TrailerSwapInput = z.infer<typeof TrailerSwapSchema>;
