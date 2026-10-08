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

export const TrailerSwapResponseSchema = z.object({
  trailer_assignment_id: z.string().uuid().nullable(),
  dropped_trailer_id: z.string().uuid().nullish(),
  created_trailer_id: z.string().uuid().nullish(),
});

/** `GET /trailers` — the optional filter for the hook picker. */
export const TrailerQuerySchema = z.object({
  trailer_type: z.enum(["DRY_VAN", "REEFER", "FLATBED", "LOWBOY", "TANKER", "CURTAIN_SIDE", "OTHER"]).optional(),
});

/** One row of `GET /trailers`: what a driver needs to choose a trailer, and nothing tenant-sensitive. */
export const TrailerOptionSchema = z.object({
  id: z.string().uuid(),
  license_plate: z.string(),
  trailer_type: z.enum(["DRY_VAN", "REEFER", "FLATBED", "LOWBOY", "TANKER", "CURTAIN_SIDE", "OTHER"]),
  status: z.string(),
  is_operational: z.boolean(),
  /** The tractor currently pulling it. Non-null means it cannot be hooked. */
  current_vehicle_id: z.string().uuid().nullable(),
  /** The reefer set-point band, used to tell the driver what temperature is in range (M6). */
  reefer_target_temp_min_c: z.number().nullable(),
  reefer_target_temp_max_c: z.number().nullable(),
  is_external: z.boolean(),
});
export type TrailerOption = z.infer<typeof TrailerOptionSchema>;

export const TrailersResponseSchema = z.object({ trailers: z.array(TrailerOptionSchema) });
