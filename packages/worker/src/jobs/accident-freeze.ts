// packages/worker/src/jobs/accident-freeze.ts
// `accident-freeze` job (05 §2 #3, N3.2 / C3.4). On accident.created, clone the configured
// freeze window (± minutes) from telemetry.location_updates into app.accident_telemetry and
// mark the report. The SHA-256 hash chain is enforced by the DB trigger
// (fn_accident_telemetry_hash_chain) on insert, so we insert in recorded_at order with
// prev_hash left NULL and let the trigger seal the chain.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";

export class AccidentFreezeJob {
  constructor(private readonly pool: PoolLike, private readonly config: ConfigClient) {}

  async run(reportId: string, now: Date = new Date()): Promise<{ points: number; available: boolean }> {
    const before = await this.config.numeric("accident.telemetry_freeze_before_minutes");
    const after = await this.config.numeric("accident.telemetry_freeze_after_minutes");
    return transaction(this.pool, async (tx) => {
      const c = tx.client;
      const cloned = await c.query(
        `INSERT INTO app.accident_telemetry (
           report_id, sequence, recorded_at, latitude, longitude, position,
           speed_kph, heading_deg, ignition, obd_attributes, source_location_id, prev_hash
         )
         SELECT $1, row_number() OVER (ORDER BY lu.recorded_at),
                lu.recorded_at, lu.latitude, lu.longitude, lu.position,
                lu.speed_kph, lu.heading_deg, lu.ignition, lu.attributes, lu.id, NULL
         FROM telemetry.location_updates lu
         JOIN app.accident_reports a ON a.vehicle_id = lu.vehicle_id
         WHERE a.id = $1
           AND lu.recorded_at BETWEEN a.occurred_at - ($2 || ' minutes')::interval
                                   AND a.occurred_at + ($3 || ' minutes')::interval
         ORDER BY lu.recorded_at
         RETURNING id`,
        [reportId, before, after],
      );
      const points = cloned.rowCount ?? 0;
      const available = points > 0;
      await c.query(
        `UPDATE app.accident_reports
         SET telemetry_available = $2, telemetry_frozen_at = $3, telemetry_point_count = $4
         WHERE id = $1`,
        [reportId, available, now, points],
      );
      if (!available) logger.warn("accident-freeze: no telemetry to freeze (R-107)", { reportId });
      return { points, available };
    });
  }
}
