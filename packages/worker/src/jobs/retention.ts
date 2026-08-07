// packages/worker/src/jobs/retention.ts
// `retention` job (05 §2 #11, D6). Nightly: summarise-then-drop expired location partitions
// (the 90-day raw retention) and delete media past its retention class. Legal-hold / Object-Locked
// rows are excluded by construction (C5.3). Dry-run is the safe default; pass wet=true to actually
// drop (prod). Media S3 deletion runs through the injected MediaPresigner (real SigV4 DELETE, or a
// logged no-op when no credentials are configured).

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";
import type { MediaPresigner } from "../media/presigner";

export interface RetentionResult {
  partitionsDropped: number;
  mediaDue: number;
  /** Media objects actually deleted from S3 (0 unless wet and a presigner is configured). */
  mediaDeleted: number;
  wet: boolean;
}

export class RetentionJob {
  constructor(
    private readonly pool: PoolLike,
    private readonly config: ConfigClient,
    private readonly presigner?: MediaPresigner,
  ) {}

  async run(wet = false, now: Date = new Date()): Promise<RetentionResult> {
    const rawDays = await this.config.numeric("retention.location_raw_days");
    let mediaDeleted = 0;
    const result = await transaction(this.pool, async (tx) => {
      const dropped = await tx.client.query<{ dropped: number }>(
        `SELECT telemetry.fn_drop_expired_location_partitions($1, $2) AS dropped`,
        [rawDays, wet],
      );
      const media = await tx.client.query<{ id: string; bucket: string; key: string }>(
        `SELECT id, bucket, key FROM app.fn_media_due_for_deletion(1000)`,
      );
      if (wet && this.presigner) {
        for (const m of media.rows) {
          await this.presigner.deleteObject(m.bucket, m.key);
          mediaDeleted++;
        }
      } else if ((media.rowCount ?? 0) > 0) {
        logger.info("retention media dry-run", { mediaDue: media.rowCount ?? 0, willDelete: wet });
      }
      logger.info("retention sweep", {
        partitionsDropped: dropped.rows[0]?.dropped ?? 0,
        mediaDue: media.rowCount,
        mediaDeleted,
        wet,
      });
      return { partitionsDropped: dropped.rows[0]?.dropped ?? 0, mediaDue: media.rowCount ?? 0, mediaDeleted, wet };
    });
    return result;
  }
}
