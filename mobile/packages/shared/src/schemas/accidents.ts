/**
 * Accident wire shapes. Mirrors `fleet-management/packages/shared/src/schemas/accidents.ts` for the
 * requests and `getOne` / `listMine` in `packages/api/src/services/accidents.ts` for the responses.
 *
 * Real answer to "where are the escalation timers and the timeline?": there are none. The detail view
 * exposes `seconds_to_escalation` (a countdown the client derives) and `chain_valid`; there is no
 * `escalation_timers` array and no `timeline` array on the wire.
 */
import { z } from 'zod';
import { AccidentPositionSource } from '../types';
import { geoPointSchema } from '../types';

export const MaydaySchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid().nullable(),
  position: geoPointSchema,
  mayday_reason: z.string().min(1).max(500),
});
export type MaydayInput = z.infer<typeof MaydaySchema>;

export const MaydayResponseSchema = z.object({
  accident_id: z.string().uuid(),
  escalated_at: z.string().datetime().nullable().optional(),
});

export const AccidentCreateSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid().nullable().optional(),
  trailer_id: z.string().uuid().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  position: geoPointSchema.optional(),
  position_source: AccidentPositionSource.optional(),
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

export const AccidentCreateResponseSchema = z.object({ accident_id: z.string().uuid() });

export const ACCIDENT_MEDIA_SLOTS = [
  'FRONT_DAMAGE',
  'REAR_DAMAGE',
  'SIDE_DAMAGE',
  'OTHER_VEHICLE_PLATE',
  'WITNESS',
  'ADDITIONAL',
  'POLICE_ABSTRACT',
  'INSURANCE_DOCUMENT',
] as const;
export type AccidentMediaSlot = (typeof ACCIDENT_MEDIA_SLOTS)[number];

export const AccidentMediaSchema = z.object({
  slot: z.enum(ACCIDENT_MEDIA_SLOTS),
  media_object_id: z.string().uuid(),
});
export type AccidentMediaInput = z.infer<typeof AccidentMediaSchema>;

export const AcknowledgeAccidentResponseSchema = z.object({
  accident_id: z.string().uuid(),
  acknowledged_at: z.string().datetime().nullable().optional(),
});

/** One row of `GET /accidents/me` (`AccidentSummaryRow`). */
export const AccidentSummaryRowSchema = z
  .object({
    accident_id: z.string().uuid(),
    reference: z.string().nullable().optional(),
    occurred_at: z.string().nullable().optional(),
    reported_at: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    mayday: z.boolean().nullable().optional(),
    escalation_tier: z.number().nullable().optional(),
    acknowledged_at: z.string().nullable().optional(),
    vehicle_label: z.string().nullable().optional(),
  })
  .passthrough();
export type AccidentSummaryRow = z.infer<typeof AccidentSummaryRowSchema>;

/** One media attachment on the detail view. The id field is `media_id`, not `media_object_id`. */
export const AccidentMediaViewSchema = z.object({
  media_id: z.string().uuid(),
  slot: z.string(),
  kind: z.string().nullable().optional(),
  pending: z.boolean().optional(),
});

/** `GET /accidents/{id}` (`AccidentDetailView`). */
export const AccidentDetailSchema = z
  .object({
    accident_id: z.string().uuid(),
    reference: z.string().nullable().optional(),
    occurred_at: z.string().nullable().optional(),
    reported_at: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    severity: z.string().nullable().optional(),
    mayday: z.boolean().nullable().optional(),
    description: z.string().nullable().optional(),
    driver_statement: z.string().nullable().optional(),
    location_label: z.string().nullable().optional(),
    vehicle_label: z.string().nullable().optional(),
    escalation_tier: z.number().nullable().optional(),
    acknowledged_by: z.string().nullable().optional(),
    /** Seconds remaining before the next escalation tier fires; the client renders the countdown. */
    seconds_to_escalation: z.number().nullable().optional(),
    chain_valid: z.boolean().nullable().optional(),
    media: z.array(AccidentMediaViewSchema).default([]),
    can_acknowledge: z.boolean().optional(),
  })
  .passthrough();
export type AccidentDetail = z.infer<typeof AccidentDetailSchema>;

/** `GET /accidents/{id}/telemetry/verify` — the frozen hash-chain verdict (C3.4). */
export const TelemetryChainSchema = z.object({
  all_valid: z.boolean(),
  rows: z.array(z.object({ sequence: z.number(), is_valid: z.boolean() }).passthrough()).default([]),
});