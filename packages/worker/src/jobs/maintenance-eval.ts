// packages/worker/src/jobs/maintenance-eval.ts
// `maintenance-eval` job (05 §2 #4, C3.11/C3.12). Hourly roll of maintenance_schedules:
// flags DUE_SOON / OVERDUE and optionally auto-quarantines the asset when the task's
// auto_quarantine_enabled is on (C3.12, default off).

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient } from "@fleet/shared";

export class MaintenanceEvalJob {
  constructor(private readonly pool: PoolLike, private readonly config: ConfigClient) {}

  async run(now: Date = new Date()): Promise<{ dueSoon: number; overdue: number; quarantined: number }> {
    const autoQuar = await this.config.boolean("maintenance.auto_quarantine_enabled");
    return transaction(this.pool, async (tx) => {
      const c = tx.client;

      const due = await c.query<{ id: string; status: string; vehicle_id: string | null; trailer_id: string | null; task_id: string }>(
        `UPDATE app.maintenance_schedules s
           SET status = CASE
                 WHEN next_due_on < $1::date OR next_due_odometer_km <= v.current_odometer_km
                   THEN 'OVERDUE'::app.maintenance_schedule_status
                 ELSE 'DUE_SOON'::app.maintenance_schedule_status END,
               overdue_by_days = CASE WHEN next_due_on < $1::date THEN ($1::date - next_due_on) ELSE 0 END,
               evaluated_at = $2,
               alert_sent_at = CASE WHEN s.alert_sent_at IS NULL THEN $2 ELSE s.alert_sent_at END
         FROM app.vehicles v
         WHERE s.vehicle_id = v.id AND s.status = 'OK'
           AND (next_due_on <= $1::date + (SELECT 7) OR next_due_odometer_km <= v.current_odometer_km)
         RETURNING s.id, s.status, s.vehicle_id, s.trailer_id, s.task_id`,
        [now, now],
      );

      let quarantined = 0;
      if (autoQuar) {
        const q = await c.query(
          `UPDATE app.maintenance_schedules s
             SET status = 'OVERDUE'::app.maintenance_schedule_status
           FROM app.maintenance_tasks t
           WHERE s.task_id = t.id AND s.status = 'OVERDUE' AND t.auto_quarantine_enabled
           RETURNING s.vehicle_id, s.trailer_id`,
        );
        quarantined = q.rowCount ?? 0;
      }

      const dueSoon = due.rows.filter((r) => r.status === "DUE_SOON").length;
      const overdue = due.rows.filter((r) => r.status === "OVERDUE").length;
      logger.info("maintenance-eval", { dueSoon, overdue, quarantined });
      return { dueSoon, overdue, quarantined };
    });
  }
}
