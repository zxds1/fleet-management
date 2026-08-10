// packages/worker/src/jobs/ocr.ts
// `ocr` job (05 §2 #12, A1.4). Sends fuel receipts to a vision adapter (Google Vision, with a
// Tesseract fallback handled by the adapter) and stores the advisory OCR result on
// fuel_purchases. Driver-entered values remain authoritative until Admin verifies.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike } from "@fleet/shared";

/**
 * Parsed fuel receipt (A1.4, photo-first). Every field is nullable: OCR is advisory and a
 * partially-read receipt is normal. The driver may correct any of these (driver_corrected) and
 * an Admin may adjust them at verification; only then do they become authoritative.
 */
export interface OcrResult {
  amount: number | null;
  liters: number | null;
  pricePerLiter: number | null;
  /** Date printed on the receipt (ISO `YYYY-MM-DD`); purchased_at stays the evidential timestamp. */
  receiptDate: string | null;
  stationName: string | null;
  confidence: number | null;
  /** Verbatim provider response, persisted to ocr_raw for later re-parsing / disputes. */
  raw: unknown;
}

export interface VisionAdapter {
  /** Returns the parsed receipt values for the given media object. */
  analyse(mediaObjectId: string): Promise<OcrResult>;
}

export class OcrJob {
  constructor(private readonly pool: PoolLike, private readonly vision: VisionAdapter) {}

  async run(limit = 50): Promise<{ processed: number; failed: number }> {
    // SKIP LOCKED keeps concurrent worker replicas off each other's rows, and the 2-day floor stops
    // a rollout (or a long outage) from draining an old backlog through the paid Vision API. Older
    // PENDING rows are settled by an Admin in the review queue rather than re-OCR'd here.
    const pending = await transaction(this.pool, async (tx) =>
      tx.client.query<{ id: string; receipt_media_object_id: string }>(
        `SELECT id, receipt_media_object_id FROM app.fuel_purchases
         WHERE ocr_status = 'PENDING'
           AND created_at > now() - interval '2 days'
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      ),
    );
    let processed = 0;
    let failed = 0;
    for (const row of pending.rows) {
      try {
        const ocr = await this.vision.analyse(row.receipt_media_object_id);
        await transaction(this.pool, async (tx) =>
          tx.client.query(
            `UPDATE app.fuel_purchases
             SET amount_spent      = CASE WHEN driver_corrected THEN amount_spent    ELSE COALESCE($1, amount_spent)       END,
                 liters_pumped     = CASE WHEN driver_corrected THEN liters_pumped   ELSE COALESCE($2, liters_pumped)      END,
                 price_per_liter   = CASE WHEN driver_corrected THEN price_per_liter ELSE COALESCE($3, price_per_liter)    END,
                 receipt_date      = CASE WHEN driver_corrected THEN receipt_date    ELSE COALESCE($4::date, receipt_date) END,
                 station_name      = CASE WHEN driver_corrected THEN station_name    ELSE COALESCE($5, station_name)       END,
                 -- A driver correction already recorded the method as MANUAL; never overwrite it.
                 ocr_method        = CASE WHEN driver_corrected THEN ocr_method ELSE 'GOOGLE_VISION' END,
                 ocr_raw           = $6::jsonb,
                 ocr_confidence    = $7,
                 ocr_status        = 'SUCCEEDED_VISION',
                 ocr_processed_at  = now(),
                 updated_at        = now()
             WHERE id = $8`,
            [
              ocr.amount,
              ocr.liters,
              // Derive the unit price when the receipt printed only the two ends of the sum.
              ocr.pricePerLiter ?? derivePricePerLiter(ocr.amount, ocr.liters),
              ocr.receiptDate,
              ocr.stationName,
              JSON.stringify(ocr.raw ?? null),
              ocr.confidence,
              row.id,
            ],
          ),
        );
        processed++;
      } catch (e) {
        await transaction(this.pool, async (tx) =>
          tx.client.query(
            `UPDATE app.fuel_purchases SET ocr_status='FAILED', ocr_processed_at=now() WHERE id=$1`,
            [row.id],
          ),
        );
        logger.warn("ocr failed", { purchaseId: row.id, message: (e as Error).message });
        failed++;
      }
    }
    return { processed, failed };
  }
}

/** Unit price from the two figures OCR is most likely to read correctly. Null when either is absent. */
export function derivePricePerLiter(amount: number | null, liters: number | null): number | null {
  if (amount == null || liters == null || liters <= 0) return null;
  return Math.round((amount / liters) * 100) / 100;
}
