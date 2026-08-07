// packages/shared/src/schemas/shifts.ts
import { z } from "zod";
import type { FuelGaugeLevel } from "../types/db";

// Runtime mirror of the app.fuel_gauge_level enum (B2). The `satisfies` guard makes a
// DDL change that adds/removes a level a compile error here.
export const FuelGaugeLevelSchema = z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]);
const _fuelGaugeLevels = FuelGaugeLevelSchema.options satisfies readonly FuelGaugeLevel[];

export const ClockInSchema = z.object({
  assignment_id: z.string().uuid(),
  start_odometer_km: z.number().int().nonnegative(),
  start_fuel_gauge: FuelGaugeLevelSchema,
  start_media_object_id: z.string().uuid(),
  phone_gps_fallback_enabled: z.boolean().default(false),
  consent_version: z.string().min(1),
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
  action: z.enum(["VERIFY", "FLAG"]),
  flag_reason: z.string().min(1).max(500).optional(),
  corrected_end_odometer_km: z.number().int().nonnegative().optional(),
});
export type VerifyShiftInput = z.infer<typeof VerifyShiftSchema>;

// Cursor pagination envelope shared by every list endpoint (D7).
export const CursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  });
