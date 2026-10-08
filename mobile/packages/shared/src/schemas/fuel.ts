/**
 * Fuel wire shapes. Mirrors `fleet-management/packages/shared/src/schemas/fuel.ts` and the row
 * projections in `packages/api/src/services/fuel.ts`.
 *
 * The real answer to "how are the before/after gauge records created?" is: they are NOT. Nothing in
 * the API creates an `app.fuel_records` row, yet `POST /fuel/refuel` demands `before_fuel_record_id`
 * and `after_fuel_record_id`, and its `requirePermission("fuel:enter")` names a permission that does
 * not exist in `app.permissions` — so that endpoint 403s for every role. The working driver flow is
 * the photo-first one, `POST /driver/fuel/purchase` (A1.4, permission `fuel:submit_purchase`), which
 * takes two photos plus the odometer and lets OCR fill the rest. The app uses that.
 */
import { z } from 'zod';
import { FuelPurchaseBadge, OcrStatus } from '../types';

const numeric = z
  .union([z.string(), z.number()])
  .transform((v) => (v === null || v === '' ? null : Number(v)))
  .nullable()
  .optional();

export const RefuelResponseSchema = z.object({
  fuel_purchase_id: z.string().uuid(),
  open_anomalies: z.array(z.string()).default([]),
});

export const VerifyPurchaseSchema = z.object({
  action: z.enum(['VERIFY', 'REJECT', 'CLEAR_PAYMENT']),
  adjusted_litres: z.number().positive().optional(),
  adjusted_amount: z.union([z.string(), z.number()]).optional(),
  adjusted_odometer: z.number().int().nonnegative().optional(),
  rejection_reason: z.string().min(1).max(500).optional(),
  admin_notes: z.string().max(2000).optional(),
});
export type VerifyPurchaseInput = z.infer<typeof VerifyPurchaseSchema>;

/** `POST /driver/fuel/purchase` (A1.4). The only refuel endpoint a driver can actually call. */
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

export const PhotoFirstRefuelResponseSchema = z.object({ fuel_purchase_id: z.string().uuid() });

/** `POST /driver/fuel/correct` — the driver corrects what OCR read. Every field is optional. */
export const FuelCorrectionSchema = z.object({
  purchase_id: z.string().uuid(),
  corrected_amount: z.number().positive().optional(),
  corrected_liters: z.number().positive().optional(),
  corrected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  corrected_station: z.string().max(120).optional(),
  corrected_odometer: z.number().nonnegative().optional(),
});
export type FuelCorrectionInput = z.infer<typeof FuelCorrectionSchema>;

export const FuelCorrectionResponseSchema = z.object({
  fuel_purchase_id: z.string().uuid(),
  price_per_liter: z.number().nullable().optional(),
});

/** `GET /driver/fuel/purchase/{id}/ocr` — polled until `ocr_status` is terminal. */
export const FuelOcrPreviewSchema = z
  .object({
    fuel_purchase_id: z.string().uuid().optional(),
    ocr_status: OcrStatus.optional(),
    ocr_liters: numeric,
    ocr_total_cost: numeric,
    ocr_confidence: numeric,
    ocr_station: z.string().nullable().optional(),
    ocr_date: z.string().nullable().optional(),
    driver_corrected: z.boolean().nullable().optional(),
    badge: FuelPurchaseBadge.optional(),
  })
  .passthrough();

/** `GET /fuel/reconciliation-inbox` row (`app.v_fuel_reconciliation_inbox`). */
export const FuelReconciliationRowSchema = z
  .object({
    fuel_purchase_id: z.string().uuid(),
    purchased_at: z.string().nullable(),
    entry_source: z.string().nullable(),
    vehicle_id: z.string().uuid().nullable(),
    vehicle_plate: z.string().nullable(),
    driver_name: z.string().nullable(),
    litres: numeric,
    total_cost: numeric,
    currency: z.string(),
    unit_price: numeric,
    odometer_km: z.number().nullable().optional(),
    fuel_card_last_four: z.string().nullable(),
    fuel_card_label: z.string().nullable(),
    receipt_media_object_id: z.string().nullable(),
    ocr_status: OcrStatus.nullable(),
    gauge_before_percent: numeric,
    gauge_after_percent: numeric,
    gauge_delta_percent: numeric,
    admin_verified: z.boolean().nullable(),
    rejected_at: z.string().nullable(),
    cleared_for_payment_at: z.string().nullable(),
    open_anomalies: z.string().nullable(),
    worst_open_severity: z.string().nullable(),
  })
  .passthrough();
export type FuelReconciliationRow = z.infer<typeof FuelReconciliationRowSchema>;

/** `GET /admin/fuel/pending` — the photo-first review queue. */
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
  confidence_score: numeric,
  ocr_raw_data: z.record(z.unknown()).nullable().optional(),
  driver_corrected: z.boolean().nullable().optional(),
  badge: FuelPurchaseBadge.default('REVIEW'),
  receipt_media_object_id: z.string().nullable().optional(),
  odometer_photo_media_object_id: z.string().nullable().optional(),
});
export type FuelPendingRow = z.infer<typeof FuelPendingRowSchema>;

export const FuelPendingResponseSchema = z.object({ purchases: z.array(FuelPendingRowSchema) });

/** `POST /fuel/purchases/{id}/verify` result. */
export const VerifyPurchaseResponseSchema = z.object({
  fuel_purchase_id: z.string().uuid(),
  status: z.string(),
});

/** `POST /fuel/cards` — creating a card is ADMIN work (`fuel:card_manage`). */
export const FuelCardCreateSchema = z.object({
  label: z.string().min(1).max(80),
  last_four: z.string().regex(/^\d{4}$/),
  provider: z.string().min(1).max(40),
  is_pooled: z.boolean(),
  assigned_vehicle_id: z.string().uuid().nullable().optional(),
});

/** `POST /reconciliation/statements` (statement CSV import). */
export const StatementImportSchema = z.object({
  provider: z.string().min(1).max(40),
  period_start: z.string().date(),
  period_end: z.string().date(),
  media_object_id: z.string().uuid(),
  column_mapping: z.record(z.string()),
});
export type StatementImportInput = z.infer<typeof StatementImportSchema>;

export const StatementImportResponseSchema = z.object({ statement_id: z.string().uuid() });
/** `GET /fuel/cards` — the optional filter for the refuel card picker. */
export const FuelCardQuerySchema = z.object({ vehicle_id: z.string().uuid().optional() });

/**
 * One card the driver may select. `last_four` and `notes` are deliberately absent: the refuel form asks the
 * driver for the four digits, and a card note is not something to read on a phone in a yard. A dedicated
 * card belonging to another vehicle is never returned.
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

/** `GET /notifications/count` — the only exact counts the API exposes. */
export const NotificationCountSchema = z.object({ total: z.number().int().nonnegative(), unread: z.number().int().nonnegative() });

/**
 * U-01: a batch of phone positions for `POST /telemetry/points`. The server enforces the batch size,
 * the age window and the sampling floor, so the client only needs to shape the request.
 */
export const PhonePointsSchema = z.object({
  points: z.array(
    z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      recorded_at: z.string().datetime({ offset: true }),
      speed_kph: z.number().nonnegative().max(300).optional(),
      heading_deg: z.number().min(0).max(360).optional(),
      accuracy_m: z.number().nonnegative().max(10_000).optional(),
      is_valid_fix: z.boolean().optional(),
    }),
  ).min(1).max(60),
});
export type PhonePointsInput = z.infer<typeof PhonePointsSchema>;

/** Mirrors `PHONE_POINTS` on the server, so the app batches the same shape it accepts. */
export const PHONE_POINTS = { maxPoints: 60, maxHistorySeconds: 300, minIntervalSeconds: 10 } as const;

/** A single phone-GPS point, derived from the batch schema above. */
export type PhonePoint = PhonePointsInput['points'][number];
