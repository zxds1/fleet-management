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

/**
 * Photo-first refuel submission (A1.4). The driver supplies two photographs and
 * an odometer reading; litres, amount, station and receipt date are read by OCR
 * server-side, so they are deliberately absent here. Extends, and does not
 * replace, RefuelSchema, which remains the gauge-pair contract (B3).
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
 * OCR trust threshold (A1.4). Expressed on the SAME 0–1 scale as
 * `app.fuel_purchases.ocr_confidence` (numeric(4,3) CHECK BETWEEN 0 AND 1). At or above this the
 * extraction is treated as clean (the AUTO badge); below it the driver and the Admin are asked to
 * check every field. Every consumer — the pending-queue SQL, the admin detail screen and the
 * driver review step — must use this single constant so the rule cannot drift or change units.
 */
export const OCR_CONFIDENCE_THRESHOLD = 0.85;

/** Driver correction of OCR output before/after submission. Sets driver_corrected. */
export const FuelCorrectionSchema = z.object({
  purchase_id: z.string().uuid(),
  corrected_amount: z.number().positive().optional(),
  corrected_liters: z.number().positive().optional(),
  corrected_date: z.string().date().optional(),
  corrected_station: z.string().max(255).optional(),
  corrected_odometer: z.number().int().nonnegative().optional(),
});
export type FuelCorrectionInput = z.infer<typeof FuelCorrectionSchema>;

export const VerifyPurchaseSchema = z.object({
  action: z.enum(["VERIFY", "REJECT", "CLEAR_PAYMENT"]),
  rejection_reason: z.string().min(1).max(500).optional(),
  // Photo-first adjustments (A1.4). Fleets Manager only (C6.1). On VERIFY these are promoted to the
  // authoritative `litres` / `total_cost` columns so reconciliation downstream reads the settled values.
  adjusted_litres: z.number().positive().optional(),
  adjusted_amount: z.number().positive().optional(),
  adjusted_odometer: z.number().int().nonnegative().optional(),
  admin_notes: z.string().max(1000).optional(),
});
export type VerifyPurchaseInput = z.infer<typeof VerifyPurchaseSchema>;

/**
 * PG numerics arrive as strings over REST; `null` is a legitimately absent measurement. Normalises
 * both to `number | null` so the client never string-compares a quantity.
 */
const NumericLike = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

/**
 * One row of `GET /admin/fuel/pending` — the photo-first admin review queue (A1.4).
 *
 * This is the SINGLE definition of that wire row: the API types its SQL projection as
 * `PendingFuelRow` from this schema and the mobile client parses with it, so a column rename on
 * either side is a compile/parse error rather than a silently empty inbox. Field names therefore
 * match the SQL aliases in `FuelQuery.pendingReview` exactly — do not re-case them.
 */
export const FuelPendingRowSchema = z.object({
  fuel_purchase_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  vehicle_plate: z.string(),
  driver_id: z.string().uuid().nullable(),
  purchased_at: z.string(),
  receipt_date: z.string().nullable(),
  station_name: z.string().nullable(),
  amount_spent: NumericLike,
  liters_pumped: NumericLike,
  price_per_liter: NumericLike,
  odometer_km: NumericLike,
  receipt_media_object_id: z.string(),
  odometer_photo_media_object_id: z.string().nullable(),
  ocr_status: z.string(),
  ocr_method: z.string().nullable(),
  /** Raw OCR field bag; keys vary per receipt template so it stays an open record. */
  ocr_raw_data: z.record(z.string(), z.unknown()).nullable(),
  confidence_score: NumericLike,
  /** True when the driver overrode an OCR value before submitting. */
  driver_corrected: z.boolean(),
  distance_since_last_refuel: NumericLike,
  cost_per_km: NumericLike,
  /** Triage outcome: FLAGGED = open severe anomaly, AUTO = clean OCR, REVIEW = human decides. */
  badge: z.enum(["AUTO", "REVIEW", "FLAGGED"]),
});
export type FuelPendingRow = z.infer<typeof FuelPendingRowSchema>;

/** Envelope of `GET /admin/fuel/pending`. */
export const FuelPendingResponseSchema = z.object({
  purchases: z.array(FuelPendingRowSchema),
});

// ---------------------------------------------------------------------------
// Hardware / tracker provisioning (A1.1, N2.3)
// ---------------------------------------------------------------------------

/**
 * Tracker manufacturers supported by the pairing SMS builder. Declared before `HardwarePairSchema`
 * so the schema can constrain `trackerBrand` to exactly this set: an unknown brand would otherwise
 * fall through to the generic `SERVER,...#` command and be handed to an installer to text at a
 * device that does not speak it.
 */
export const TRACKER_BRANDS = [
  "TELTONIKA",
  "JIMI_CONCOX",
  "QUECLINK",
  "SINOTRACK",
  "TKSTAR",
  "RUPTELA",
  "GENERIC_H02",
  "GENERIC_GT06",
] as const;
export type TrackerBrand = (typeof TRACKER_BRANDS)[number];

/** Known device models per brand. GENERIC_* are the protocol-only fallbacks. */
export const TRACKER_DEVICE_MODELS: readonly { brand: TrackerBrand; models: readonly string[] }[] = [
  { brand: "TELTONIKA", models: ["FMB920", "FMB003", "FMB130", "FMC130", "FMB640"] },
  { brand: "JIMI_CONCOX", models: ["GT06N", "JM-VL01", "JM-LL301", "GV20", "OB22"] },
  { brand: "QUECLINK", models: ["GV55", "GV75", "GV300", "GL300", "GV600W"] },
  { brand: "SINOTRACK", models: ["ST-901", "ST-901A", "ST-903", "ST-906", "ST-915"] },
  { brand: "TKSTAR", models: ["TK905", "TK909", "TK915", "TK103B"] },
  { brand: "RUPTELA", models: ["FM-Eco4", "FM-Pro4", "FM-Tco4", "FM-Plug4"] },
  { brand: "GENERIC_H02", models: ["H02"] },
  { brand: "GENERIC_GT06", models: ["GT06"] },
] as const;

/**
 * Pair a physical tracker to a vehicle. The IMEI is narrowed to 15 digits here;
 * app.vehicles.tracker_imei accepts 14-17 to keep legacy imports valid.
 */
export const HardwarePairSchema = z.object({
  vehicleId: z.string().uuid(),
  trackerImei: z.string().regex(/^[0-9]{15}$/),
  trackerBrand: z.enum(TRACKER_BRANDS).default("GENERIC_H02"),
  /** Device model within the brand (`TRACKER_DEVICE_MODELS`). Recorded for field support. */
  trackerModel: z.string().max(40).optional(),
  trackerSimNumber: z.string().max(20).optional(),
});
export type HardwarePairInput = z.infer<typeof HardwarePairSchema>;

export const HardwarePairResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  /** SMS the installer sends to the tracker SIM to point it at the Traccar listener. */
  smsCommand: z.string(),
  simNumber: z.string().nullable().optional(),
  vehiclePlate: z.string(),
});
export type HardwarePairResult = z.infer<typeof HardwarePairResultSchema>;

export const HardwareTrackerStatusSchema = z.object({
  vehiclePlate: z.string(),
  imei: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable().optional(),
  pairedAt: z.string().datetime().nullable(),
  lastPing: z.string().datetime().nullable(),
  status: z.enum(["PENDING", "ONLINE", "OFFLINE", "LOST"]),
});
export type HardwareTrackerStatus = z.infer<typeof HardwareTrackerStatusSchema>;

