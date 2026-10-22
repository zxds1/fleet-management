// packages/shared/src/schemas/accidents.ts
import { z } from "zod";

/**
 * A GPS pair. `strict()` so a typo'd member is a 400 rather than a silently dropped coordinate.
 */
const PositionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const MaydaySchema = z
  .object({
    shift_id: z.string().uuid().nullable(),
    vehicle_id: z.string().uuid().nullable(),
    position: PositionSchema,
    mayday_reason: z.string().min(1).max(500),
  })
  .strict();
export type MaydayInput = z.infer<typeof MaydaySchema>;

/**
 * `POST /accidents`.
 *
 * The counterparty plate arrives under two names: `third_party_plate` is the column
 * (`app.accident_reports.third_party_plate`) and the name the OpenAPI document has always used,
 * while the mobile client sends `other_vehicle_plate`. Both are accepted and map to that one
 * column, so the plate the driver typed is never dropped.
 *
 * `severity` is deliberately NOT a member: `app.accident_reports` has no severity column — the
 * severity is derived server-side from the mayday flag and the investigation status
 * (repositories/accidents.ts). The schema is `strict()`, so a client that sends `severity` gets a
 * 400 VALIDATION_ERROR instead of a silent strip that looks like it was stored. Persisting a
 * client-supplied severity needs a database migration (add the column + backfill), which is out of
 * the API package's scope.
 */
export const AccidentCreateSchema = z
  .object({
    shift_id: z.string().uuid().nullable(),
    vehicle_id: z.string().uuid().nullable().optional(),
    trailer_id: z.string().uuid().nullable().optional(),
    occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
    position: PositionSchema.optional(),
    position_source: z.enum(["TRACKER", "PHONE_GPS", "MANUAL"]).optional(),
    driver_statement: z.string().max(5000).optional(),
    witness_name: z.string().max(200).optional(),
    witness_phone: z.string().max(20).optional(),
    third_party_name: z.string().max(200).optional(),
    third_party_phone: z.string().max(20).optional(),
    third_party_plate: z.string().max(20).optional(),
    other_vehicle_plate: z.string().max(20).optional(),
    third_party_insurer: z.string().max(120).optional(),
    police_ob_number: z.string().max(60).optional(),
    insurance_claim_number: z.string().max(60).optional(),
  })
  .strict();
export type AccidentCreateInput = z.infer<typeof AccidentCreateSchema>;

/**
 * `POST /accidents/{accidentId}/media`. `slot` mirrors the `app.accident_media_slot` enum and
 * `media_object_id` is required — the row is useless without the uploaded object.
 */
export const AccidentMediaSchema = z
  .object({
    slot: z.enum([
      "FRONT_DAMAGE",
      "REAR_DAMAGE",
      "SIDE_DAMAGE",
      "OTHER_VEHICLE_PLATE",
      "WITNESS",
      "ADDITIONAL",
      "POLICE_ABSTRACT",
      "INSURANCE_DOCUMENT",
    ]),
    media_object_id: z.string().uuid(),
  })
  .strict();
export type AccidentMediaInput = z.infer<typeof AccidentMediaSchema>;
