// packages/worker/src/jobs/document-expiry.ts
// `document-expiry` job (05 §2 #5, B8/C3.10). Daily sweep: blocking documents past expiry
// ground their owning asset (is_operational=false) and enqueue T-7 / weekly digest alerts.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";

export class DocumentExpiryJob {
  constructor(private readonly pool: PoolLike, private readonly config: ConfigClient) {}

  async run(now: Date = new Date()): Promise<{ grounded: number; warned: number }> {
    const warnDays = await this.config.numeric("documents.warn_days_before");
    return transaction(this.pool, async (tx) => {
      const c = tx.client;
      const groundedV = await c.query(
        `UPDATE app.vehicles v SET is_operational = false, non_operational_reason = 'DOCUMENT_EXPIRED'
         FROM app.asset_documents d
         WHERE d.vehicle_id = v.id AND d.is_blocking AND d.expires_on < $1
           AND d.deleted_at IS NULL AND d.superseded_by_id IS NULL AND v.is_operational = true
         RETURNING v.id`,
        [now],
      );
      const groundedT = await c.query(
        `UPDATE app.trailers t SET is_operational = false, non_operational_reason = 'DOCUMENT_EXPIRED'
         FROM app.asset_documents d
         WHERE d.trailer_id = t.id AND d.is_blocking AND d.expires_on < $1
           AND d.deleted_at IS NULL AND d.superseded_by_id IS NULL AND t.is_operational = true
         RETURNING t.id`,
        [now],
      );
      const grounded = (groundedV.rowCount ?? 0) + (groundedT.rowCount ?? 0);

      const warned = await c.query(
        `SELECT id, vehicle_id, trailer_id, document_type, expires_on
         FROM app.asset_documents
         WHERE deleted_at IS NULL AND superseded_by_id IS NULL AND is_blocking
           AND expires_on BETWEEN $1 AND $1 + ($2 || ' days')::interval`,
        [now, warnDays],
      );
      logger.info("document-expiry sweep", { grounded, dueSoon: warned.rowCount });
      return { grounded, warned: warned.rowCount ?? 0 };
    });
  }
}
