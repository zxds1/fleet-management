// packages/worker/src/jobs/efficiency-baseline.ts
// `efficiency-baseline` job (05 §2 #8, B6). Daily per-vehicle rolling baseline over the last
// fuel.efficiency_rolling_shifts shifts (default 30, min sample fuel.efficiency_min_sample).
// Back-fills baseline_l_per_100km / deviation_percent on exact records that lack one, falling
// back to the fleet baseline when the sample is too small.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";

export class EfficiencyBaselineJob {
  constructor(private readonly pool: PoolLike, private readonly config: ConfigClient) {}

  async run(now: Date = new Date()): Promise<{ baselined: number }> {
    const rolling = await this.config.numeric("fuel.efficiency_rolling_shifts");
    const minSample = await this.config.numeric("fuel.efficiency_min_sample");
    return transaction(this.pool, async (tx) => {
      const fleet = await tx.client.query<{ base: number | null }>(
        `SELECT AVG(l_per_100km) AS base FROM (
           SELECT DISTINCT ON (shift_id) l_per_100km FROM app.fuel_efficiency_records
           WHERE is_approximate = false ORDER BY shift_id, computed_at DESC
         ) s`,
        [],
      );
      const fleetBase = fleet.rows[0]?.base ?? null;

      const res = await tx.client.query(
        `UPDATE app.fuel_efficiency_records e
         SET baseline_l_per_100km = COALESCE(b.vehicle_base, $3),
             baseline_scope = CASE WHEN b.vehicle_base IS NOT NULL THEN 'VEHICLE' ELSE 'FLEET' END,
             deviation_percent = CASE WHEN COALESCE(b.vehicle_base, $3) > 0
               THEN ((e.l_per_100km - COALESCE(b.vehicle_base, $3)) / COALESCE(b.vehicle_base, $3)) * 100 ELSE NULL END
         FROM (
           SELECT DISTINCT ON (r.vehicle_id) r.vehicle_id,
             CASE WHEN count(r2.id) OVER (PARTITION BY r.vehicle_id) >= $4
               THEN avg(r2.l_per_100km) OVER (PARTITION BY r.vehicle_id) ELSE NULL END AS vehicle_base
           FROM app.fuel_efficiency_records r
           LEFT JOIN app.fuel_efficiency_records r2
             ON r2.vehicle_id = r.vehicle_id AND r2.is_approximate = false AND r2.computed_at < r.computed_at
           WHERE r.baseline_l_per_100km IS NULL AND r.is_approximate = false
           ORDER BY r.vehicle_id, r.computed_at DESC
         ) b
         WHERE e.vehicle_id = b.vehicle_id AND e.baseline_l_per_100km IS NULL AND e.is_approximate = false`,
        [now, rolling, fleetBase, minSample],
      );
      logger.info("efficiency-baseline", { baselined: res.rowCount });
      return { baselined: res.rowCount ?? 0 };
    });
  }
}
