// packages/shared/src/schemas/accidents.ts
import { z } from "zod";

export const MaydaySchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid().nullable(),
  position: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  mayday_reason: z.string().min(1).max(500),
});
export type MaydayInput = z.infer<typeof MaydaySchema>;

export const AccidentCreateSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid().nullable().optional(),
  trailer_id: z.string().uuid().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  position: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
  position_source: z.enum(["TRACKER", "PHONE_GPS", "MANUAL"]).optional(),
  driver_statement: z.string().max(5000).optional(),
  witness_name: z.string().max(200).optional(),
  witness_phone: z.string().max(20).optional(),
  third_party_name: z.string().max(200).optional(),
  third_party_phone: z.string().max(20).optional(),
  third_party_plate: z.string().max(20).optional(),
  third_party_insurer: z.string().max(120).optional(),
  police_ob_number: z.string().max(60).optional(),
  insurance_claim_number: z.string().max(60).optional(),
});
export type AccidentCreateInput = z.infer<typeof AccidentCreateSchema>;

export const AccidentMediaSchema = z.object({
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
});
export type AccidentMediaInput = z.infer<typeof AccidentMediaSchema>;
