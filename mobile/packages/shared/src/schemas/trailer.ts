/**
 * Trailer swap. Mirrors `fleet-management/packages/shared/src/schemas/trailer.ts`.
 *
 * `trailer_id` picks an existing trailer, `new_trailer_plate` + `new_trailer_type` create one (C1.11).
 * The app sends `trailer_id: null` for a bobtail (C1.12).
 */
import { z } from 'zod';
import { TrailerType } from '../types';

export const TrailerSwapSchema = z.object({
  shift_id: z.string().uuid().nullable().optional(),
  vehicle_id: z.string().uuid(),
  trailer_id: z.string().uuid().nullable().optional(),
  new_trailer_plate: z.string().min(1).max(20).optional(),
  new_trailer_type: TrailerType.optional(),
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
export const TrailerQuerySchema = z.object({ trailer_type: TrailerType.optional() });

/** One row of `GET /trailers`. A trailer with a `current_vehicle_id` cannot be hooked. */
export const TrailerOptionSchema = z.object({
  id: z.string().uuid(),
  license_plate: z.string(),
  trailer_type: TrailerType,
  status: z.string(),
  is_operational: z.boolean(),
  current_vehicle_id: z.string().uuid().nullable(),
  /** The reefer set-point band (M6), so the DVIR can say what temperature is in range. */
  reefer_target_temp_min_c: z.number().nullable(),
  reefer_target_temp_max_c: z.number().nullable(),
  is_external: z.boolean(),
});
export type TrailerOption = z.infer<typeof TrailerOptionSchema>;

export const TrailersResponseSchema = z.object({ trailers: z.array(TrailerOptionSchema) });
