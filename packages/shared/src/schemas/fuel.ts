// packages/shared/src/schemas/fuel.ts
import { z } from "zod";

export const RefuelSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid(),
  fuel_card_id: z.string().uuid().nullable().optional(),
  fuel_card_last_four: z.string().regex(/^\d{4}$/),
  litres: z.number().positive(),
  total_cost: z.object({ amount: z.string(), currency: z.string().length(3).default("KES") }),
  odometer_km: z.number().int().nonnegative(),
  purchased_at: z.string().datetime(),
  before_fuel_record_id: z.string().uuid(),
  after_fuel_record_id: z.string().uuid(),
  receipt_media_object_id: z.string().uuid(),
  supplier_name: z.string().max(120).optional(),
});
export type RefuelInput = z.infer<typeof RefuelSchema>;

export const VerifyPurchaseSchema = z.object({
  action: z.enum(["VERIFY", "REJECT", "CLEAR_PAYMENT"]),
  adjusted_litres: z.number().positive().optional(),
  adjusted_amount: z.union([z.string(), z.number()]).optional(),
  adjusted_odometer: z.number().int().nonnegative().optional(),
  rejection_reason: z.string().min(1).max(500).optional(),
  admin_notes: z.string().max(2000).optional(),
});
export type VerifyPurchaseInput = z.infer<typeof VerifyPurchaseSchema>;

/**
 * `POST /driver/fuel/purchase` — photo-first refuel (A1.4). The receipt and odometer photos are
 * uploaded first; `odometer_reading` is the only hand-typed value (amount/litres/date/station are
 * OCR'd server-side).
 */
export const PhotoFirstRefuelSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid(),
  odometer_reading: z.number().int().nonnegative(),
  receipt_media_object_id: z.string().uuid(),
  odometer_photo_media_object_id: z.string().uuid(),
  fuel_card_last_four: z.string().regex(/^\d{4}$/).optional(),
  purchased_at: z.string().datetime(),
});
export type PhotoFirstRefuelInput = z.infer<typeof PhotoFirstRefuelSchema>;

/**
 * `POST /driver/fuel/correct` — driver correction of an OCR'd field (A1.4 step 7). Every corrected
 * field is optional: a partial correction is valid, and the original machine-read values stay
 * auditable alongside it.
 */
export const FuelCorrectionSchema = z.object({
  purchase_id: z.string().uuid(),
  corrected_amount: z.number().positive().optional(),
  corrected_liters: z.number().positive().optional(),
  corrected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  corrected_station: z.string().max(120).optional(),
  corrected_odometer: z.number().nonnegative().optional(),
});
export type FuelCorrectionInput = z.infer<typeof FuelCorrectionSchema>;

/** Triage outcome of a photo-first purchase (A1.4): auto-accepted, needs review, or flagged. */
export const FuelPendingBadgeSchema = z.enum(["AUTO", "REVIEW", "FLAGGED"]);
export type FuelPendingBadge = z.infer<typeof FuelPendingBadgeSchema>;

const numeric = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .nullable()
  .optional();

/**
 * One row of `GET /admin/fuel/pending` — the photo-first review queue. Richer than the statement
 * inbox row: it carries the OCR bag, the driver's corrections, both evidence photos and the derived
 * economics. Tolerant on everything the review screen renders as "—".
 */
export const FuelPendingRowSchema = z.object({
  fuel_purchase_id: z.string(),
  vehicle_id: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  station_name: z.string().nullable().optional(),
  receipt_date: z.string().nullable().optional(),
  amount_spent: numeric,
  liters_pumped: numeric,
  odometer_km: numeric,
  distance_since_last_refuel: numeric,
  cost_per_km: numeric,
  /** 0–1 OCR confidence; compare against OCR_CONFIDENCE_THRESHOLD. */
  confidence_score: numeric,
  ocr_raw_data: z.record(z.unknown()).nullable().optional(),
  driver_corrected: z.boolean().nullable().optional(),
  badge: FuelPendingBadgeSchema.default("REVIEW"),
  receipt_media_object_id: z.string().nullable().optional(),
  odometer_photo_media_object_id: z.string().nullable().optional(),
});
export type FuelPendingRow = z.infer<typeof FuelPendingRowSchema>;

/** `GET /admin/fuel/pending` envelope. A bare array is accepted by callers as a fallback. */
export const FuelPendingResponseSchema = z.object({
  purchases: z.array(FuelPendingRowSchema),
});
export type FuelPendingResponse = z.infer<typeof FuelPendingResponseSchema>;
