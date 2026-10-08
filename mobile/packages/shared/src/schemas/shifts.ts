/**
 * Shift wire shapes. Mirrors `fleet-management/packages/shared/src/schemas/shifts.ts` for the
 * requests and the projections in `packages/api/src/services/shift.ts` /
 * `repositories/shifts.ts` for the responses.
 *
 * Two real facts the earlier guess got wrong: clock-out returns only `{ shift_id }` (the openapi
 * `state` / `shift_duration_seconds` / `distance_km` are not implemented), and the verification
 * inbox row is the `app.v_shift_verification_inbox` projection, not a minimal shift row.
 */
import { z } from 'zod';
import { FuelGaugeLevel, ShiftState, ShiftVerificationStatus, uuid } from '../types';

export const FuelGaugeLevelSchema = FuelGaugeLevel;

export const ClockInSchema = z.object({
  assignment_id: z.string().uuid(),
  start_odometer_km: z.number().int().nonnegative(),
  start_fuel_gauge: FuelGaugeLevelSchema,
  start_media_object_id: z.string().uuid(),
  phone_gps_fallback_enabled: z.boolean().default(false),
  consent_version: z.string().min(1),
  planned_notes: z.string().max(2000).optional(),
  work_plan_media_object_ids: z.array(z.string().uuid()).max(5).optional(),
});
export type ClockInInput = z.infer<typeof ClockInSchema>;

export const ClockOutSchema = z.object({
  shift_id: z.string().uuid(),
  end_odometer_km: z.number().int().nonnegative(),
  end_fuel_gauge: FuelGaugeLevelSchema,
  end_media_object_id: z.string().uuid(),
  debrief_notes: z.string().max(2000).optional(),
});
export type ClockOutInput = z.infer<typeof ClockOutSchema>;

export const VerifyShiftSchema = z.object({
  action: z.enum(['VERIFY', 'FLAG']),
  flag_reason: z.string().min(1).max(500).optional(),
  corrected_end_odometer_km: z.number().int().nonnegative().optional(),
});
export type VerifyShiftInput = z.infer<typeof VerifyShiftSchema>;

export const ClockInResponseSchema = z.object({
  shift_id: z.string().uuid(),
  clock_in_at: z.string().datetime(),
  disclaimer: z.string().nullish(),
});

/** The only body clock-out returns. */
export const ClockOutResponseSchema = z.object({ shift_id: z.string().uuid() });

export const VerifyShiftResponseSchema = z.object({
  shift_id: z.string().uuid(),
  status: z.string().optional(),
});

export const ForceCloseShiftSchema = z.object({ reason: z.string().max(500).optional() });

/** `GET /shifts/me/active` — a bare nullable object, not an envelope. */
export const ActiveShiftSchema = z
  .object({
    shift_id: z.string().uuid(),
    vehicle_id: z.string().uuid(),
    trailer_id: z.string().uuid().nullable().optional(),
    clock_in_at: z.string().datetime(),
  })
  .nullable();

/** `GET /shifts/me` — the driver's own shift history. */
export const ShiftHistoryRowSchema = z.object({
  shift_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable(),
  vehicle_plate: z.string().nullable(),
  clock_in_at: z.string().datetime(),
  clock_out_at: z.string().datetime().nullable(),
  duration_seconds: z.number().nullable(),
  distance_km: z.string().nullable(),
  state: ShiftState.nullable(),
  verification_status: ShiftVerificationStatus.nullable(),
});

/**
 * `GET /shifts/verification-inbox` row — the `app.v_shift_verification_inbox` projection.
 * Numeric aggregates arrive as PG strings, so they are parsed leniently.
 */
const looseNum = z.union([z.string(), z.number()]).transform((v) => (v === null || v === '' ? null : Number(v))).nullable().optional();
const looseInt = z.union([z.string(), z.number()]).transform((v) => (v === null || v === '' ? null : Math.trunc(Number(v)))).nullable().optional();

export const ShiftVerificationInboxRowSchema = z
  .object({
    shift_id: z.string().uuid(),
    operational_date: z.string().nullable(),
    verification_status: ShiftVerificationStatus.nullable(),
    state: ShiftState.nullable(),
    is_overrun: z.boolean().nullable(),
    tracker_reliability: z.string().nullable(),
    driver_id: z.string().uuid().nullable(),
    driver_name: z.string().nullable(),
    vehicle_id: z.string().uuid().nullable(),
    vehicle_plate: z.string().nullable(),
    trailer_plate: z.string().nullable(),
    clock_in_at: z.string().datetime().nullable(),
    clock_out_at: z.string().datetime().nullable(),
    clock_out_source: z.string().nullable(),
    shift_duration_seconds: looseNum,
    driving_duration_seconds: looseNum,
    total_distance_km: looseNum,
    distance_source: z.string().nullable(),
    start_odometer_km: looseInt,
    end_odometer_km: looseInt,
    blocking_failures: z.string().nullable(),
    warning_failures: z.string().nullable(),
    fuel_purchase_count: z.string().nullable(),
    open_anomalies: z.string().nullable(),
    pending_expenses: z.string().nullable(),
    closeout_missing: z.unknown().nullable(),
    flag_reason: z.string().nullable(),
    locked_at: z.string().datetime().nullable(),
  })
  .passthrough();
export type ShiftVerificationInboxRow = z.infer<typeof ShiftVerificationInboxRowSchema>;

/** `GET /shifts/{id}/work-plan`. */
export const ShiftWorkPlanSchema = z.object({
  shift_id: z.string().uuid(),
  planned_notes: z.string().nullable().optional(),
  photos: z.array(z.object({ media_object_id: z.string().uuid(), sequence: z.number() })).default([]),
  debrief_notes: z.string().nullable().optional(),
});

/** `GET /shifts/{id}/verification` — the same projection, single row. */
export const ShiftVerificationDetailSchema = ShiftVerificationInboxRowSchema.nullable();

export { uuid };