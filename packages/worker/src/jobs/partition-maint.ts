// packages/worker/src/jobs/partition-maint.ts
// `partition-maint` job (05 §2 #10, 06). Nightly: pre-create the next 3 months of
// telemetry.location_updates partitions and the audit partitions so writes never hit the
// default, and alert if location_updates_default ever received a row.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike } from "@fleet/shared";

export class PartitionMaintJob {
  constructor(private readonly pool: PoolLike) {}

  async run(): Promise<{ ensured: boolean }> {
    return transaction(this.pool, async (tx) => {
      await tx.client.query(`SELECT telemetry.fn_ensure_location_partitions(3)`);
      await tx.client.query(`SELECT audit.fn_ensure_audit_partitions(1)`);
      const stray = await tx.client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM telemetry.location_updates_default`,
      );
      if ((stray.rows[0]?.n ?? 0) > 0) {
        logger.error("partition-maint: rows landed in location_updates_default — partitions fell behind");
      }
      return { ensured: true };
    });
  }
}
