// packages/worker/src/jobs/ocr.ts
// `ocr` job (05 §2 #12, A1.4). Sends fuel receipts to a vision adapter (Google Vision, with a
// Tesseract fallback handled by the adapter) and stores the advisory OCR result on
// fuel_purchases. Driver-entered values remain authoritative until Admin verifies.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike } from "@fleet/shared";

export interface OcrResult {
  litres: number | null;
  totalCost: number | null;
  confidence: number | null;
}

export interface VisionAdapter {
  /** Returns the parsed receipt values for the given media object. */
  analyse(mediaObjectId: string): Promise<OcrResult>;
}

export class OcrJob {
  constructor(private readonly pool: PoolLike, private readonly vision: VisionAdapter) {}

  async run(limit = 50): Promise<{ processed: number; failed: number }> {
    const pending = await transaction(this.pool, async (tx) =>
      tx.client.query<{ id: string; receipt_media_object_id: string }>(
        `SELECT id, receipt_media_object_id FROM app.fuel_purchases
         WHERE ocr_status = 'PENDING' ORDER BY created_at LIMIT $1`,
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
             SET ocr_litres=$1, ocr_total_cost=$2, ocr_confidence=$3, ocr_status='PROCESSED', ocr_processed_at=now()
             WHERE id=$4`,
            [ocr.litres, ocr.totalCost, ocr.confidence, row.id],
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
