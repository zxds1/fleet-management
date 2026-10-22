// packages/shared/src/schemas/fuel.ts
import { z } from "zod";

// RETIRED: the B3 gauge-pair `RefuelSchema` (before_fuel_record_id / after_fuel_record_id) is gone. No
// endpoint ever created an `app.fuel_records` row, so the ids could not be obtained, and the database
// already backs the photo-first flow with the `DRIVER_PHOTO` entry source (migration 12).
// `PhotoFirstRefuelSchema` below is the only driver fuel entry point. See docs/ASSUMPTIONS.md U-12.

export const VerifyPurchaseSchema = z
  .object({
    action: z.enum(["VERIFY", "REJECT", "CLEAR_PAYMENT"]),
    adjusted_litres: z.number().positive().optional(),
    adjusted_amount: z.union([z.string(), z.number()]).optional(),
    adjusted_odometer: z.number().int().nonnegative().optional(),
    rejection_reason: z.string().min(1).max(500).optional(),
    admin_notes: z.string().max(2000).optional(),
  })
  .strict();
export type VerifyPurchaseInput = z.infer<typeof VerifyPurchaseSchema>;

/**
 * `POST /driver/fuel/purchase` — photo-first refuel (A1.4). The receipt and odometer photos are
 * uploaded first; `odometer_reading` is the only hand-typed value (amount/litres/date/station are
 * OCR'd server-side).
 */
export const PhotoFirstRefuelSchema = z
  .object({
    shift_id: z.string().uuid().nullable(),
    vehicle_id: z.string().uuid(),
    odometer_reading: z.number().int().nonnegative(),
    receipt_media_object_id: z.string().uuid(),
    odometer_photo_media_object_id: z.string().uuid(),
    fuel_card_last_four: z.string().regex(/^\d{4}$/).optional(),
    purchased_at: z.string().datetime(),
  })
  .strict();
export type PhotoFirstRefuelInput = z.infer<typeof PhotoFirstRefuelSchema>;

/**
 * `POST /driver/fuel/correct` — driver correction of an OCR'd field (A1.4 step 7). Every corrected
 * field is optional: a partial correction is valid, and the original machine-read values stay
 * auditable alongside it.
 */
export const FuelCorrectionSchema = z
  .object({
    purchase_id: z.string().uuid(),
    corrected_amount: z.number().positive().optional(),
    corrected_liters: z.number().positive().optional(),
    corrected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    corrected_station: z.string().max(120).optional(),
    corrected_odometer: z.number().nonnegative().optional(),
  })
  .strict();
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
 * The canonical fuel purchase row (M6). ONE shape for every fuel read surface — the
 * reconciliation inbox, the review queue and the detail screens all return these names.
 *
 * The canonical money/volume names are `total_cost` and `litres` (the reporting columns). The
 * photo-first capture columns `amount_spent` / `liters_pumped` are the fallback for a purchase
 * that has not been verified yet: migration 12 seeds `litres` / `total_cost` with 0 until an Admin
 * settles the figures, and the server promotes them on VERIFY. The server projects
 * `COALESCE(NULLIF(<promoted>, 0), <captured>)`, so a row never reads as "0 litres" just because
 * it is still awaiting review.
 *
 * `ocr_confidence` (0–1) is compared against `OCR_CONFIDENCE_THRESHOLD`; `badge` is the triage
 * verdict and is only meaningful on the review queue.
 */
export const FuelPurchaseRowSchema = z.object({
  fuel_purchase_id: z.string(),
  purchased_at: z.string().nullable().optional(),
  receipt_date: z.string().nullable().optional(),
  station_name: z.string().nullable().optional(),
  vehicle_id: z.string().nullable().optional(),
  vehicle_plate: z.string().nullable().optional(),
  driver_id: z.string().nullable().optional(),
  driver_name: z.string().nullable().optional(),
  /** Canonical total cost of the purchase. */
  total_cost: numeric,
  /** Canonical volume of the purchase. */
  litres: numeric,
  currency: z.string().nullable().optional(),
  unit_price: numeric,
  odometer_km: numeric,
  ocr_status: z.string().nullable().optional(),
  ocr_method: z.string().nullable().optional(),
  /** 0–1 OCR confidence; compare against OCR_CONFIDENCE_THRESHOLD. */
  ocr_confidence: numeric,
  ocr_raw_data: z.record(z.unknown()).nullable().optional(),
  driver_corrected: z.boolean().nullable().optional(),
  gauge_before_percent: numeric,
  gauge_after_percent: numeric,
  badge: FuelPendingBadgeSchema.nullable().optional(),
  distance_since_last_refuel: numeric,
  cost_per_km: numeric,
  admin_verified: z.boolean().nullable().optional(),
  rejected_at: z.string().nullable().optional(),
  cleared_for_payment_at: z.string().nullable().optional(),
  open_anomalies: numeric,
  worst_open_severity: z.string().nullable().optional(),
  receipt_media_object_id: z.string().nullable().optional(),
  odometer_photo_media_object_id: z.string().nullable().optional(),
});
export type FuelPurchaseSummary = z.infer<typeof FuelPurchaseRowSchema>;

/** @deprecated Use {@link FuelPurchaseRowSchema} — the canonical fuel purchase row. */
export const FuelPendingRowSchema = FuelPurchaseRowSchema;
/** @deprecated Use {@link FuelPurchaseSummary}. */
export type FuelPendingRow = FuelPurchaseSummary;

/** `GET /admin/fuel/pending` envelope. A bare array is accepted by callers as a fallback. */
export const FuelPendingResponseSchema = z.object({
  purchases: z.array(FuelPurchaseRowSchema),
});
export type FuelPendingResponse = z.infer<typeof FuelPendingResponseSchema>;

/** `GET /fuel/cards` — the optional filter for the refuel card picker. */
export const FuelCardQuerySchema = z.object({
  vehicle_id: z.string().uuid().optional(),
});

/**
 * One card the driver may select. `last_four` and `notes` are deliberately absent: the refuel form
 * asks the driver for the four digits, and a card note is not something a driver should read on a phone
 * in a yard. A dedicated card belonging to another vehicle is never returned by the route.
 */
export const FuelCardOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  provider: z.string(),
  is_pooled: z.boolean(),
  assigned_vehicle_id: z.string().uuid().nullable(),
  status: z.string(),
});
export type FuelCardOption = z.infer<typeof FuelCardOptionSchema>;

export const FuelCardsResponseSchema = z.object({ cards: z.array(FuelCardOptionSchema) });

/**
 * `GET /fuel/reconciliation-inbox` — the canonical, cursor-paged fuel purchase list. The same
 * `FuelPurchaseRow` shape as `/admin/fuel/pending`, so the review queue and the standalone fuel
 * screen can never drift apart on field names.
 */
export const FuelPurchasePageSchema = z.object({
  data: z.array(FuelPurchaseRowSchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
export type FuelPurchasePage = z.infer<typeof FuelPurchasePageSchema>;
