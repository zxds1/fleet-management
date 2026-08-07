// packages/worker/src/jobs/retention.ts
// `retention` job (05 §2 #11, D6). Nightly: summarise-then-drop expired location partitions
// (the 90-day raw retention) and delete media past its retention class. Legal-hold / Object-Locked
// rows are excluded by construction (C5.3). Dry-run is the safe default; pass wet=true to actually
// drop (prod). Media S3 deletion is delegated to MediaPresigner and run as a follow-up.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";

export interface RetentionResult {
  partitionsDropped: number;
  mediaDue: number;
  wet: boolean;
}

export class RetentionJob {
  constructor(private readonly pool: PoolLike, private readonly config: ConfigClient) {}

  async run(wet = false, now: Date = new Date()): Promise<RetentionResult> {
    const rawDays = await this.config.numeric("retention.location_raw_days");
    return transaction(this.pool, async (tx) => {
      const dropped = await tx.client.query<{ dropped: number }>(
        `SELECT telemetry.fn_drop_expired_location_partitions($1, $2) AS dropped`,
        [rawDays, wet],
      );
      const media = await tx.client.query<{ id: string; bucket: string; key: string }>(
        `SELECT id, bucket, key FROM app.fn_media_due_for_deletion(1000)`,
      );
      logger.info("retention sweep", { partitionsDropped: dropped.rows[0]?.dropped ?? 0, mediaDue: media.rowCount, wet });
      return { partitionsDropped: dropped.rows[0]?.dropped ?? 0, mediaDue: media.rowCount ?? 0, wet };
    });
  }
}
