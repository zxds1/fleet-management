// packages/worker/src/jobs/stale-shift.ts
// `stale-shift` job (05 §2 #7, C3.8). Hourly: flag open shifts older than
// shift.stale_open_hours whose tracker has been offline longer than
// shift.stale_tracker_offline_hours, and alert Admin.

import { transaction } from "@fleet/db";
import { logger, RealtimeChannels, type ConfigClient, type EventPublisher, type PoolLike } from "@fleet/shared";
import type { NotificationRow } from "@fleet/shared";

export class StaleShiftJob {
  constructor(
    private readonly pool: PoolLike,
    private readonly config: ConfigClient,
    private readonly publisher?: EventPublisher,
  ) {}

  async run(now: Date = new Date()): Promise<{ flagged: number }> {
    const staleOpen = await this.config.numeric("shift.stale_open_hours");
    const staleTracker = await this.config.numeric("shift.stale_tracker_offline_hours");
    const created: NotificationRow[] = [];
    await transaction(this.pool, async (tx) => {
      const res = await tx.client.query<{ id: string }>(
        `SELECT s.id
         FROM app.shifts s
         JOIN app.tracker_health h ON h.vehicle_id = s.vehicle_id
         WHERE s.clock_out_at IS NULL
           AND s.clock_in_at < $1 - ($2 || ' hours')::interval
           AND (h.is_online = false OR h.offline_since < $1 - ($3 || ' hours')::interval)`,
        [now, staleOpen, staleTracker],
      );
      // Alert Admin (notification row consumed by the notifications job).
      for (const r of res.rows) {
        const inserted = await tx.client.query<NotificationRow>(
          `INSERT INTO app.notifications (recipient_user_id, channel, priority, title, body, payload)
           SELECT u.id, 'PUSH'::app.notification_channel, 'HIGH'::app.notification_priority,
                  'Stale open shift', $2, jsonb_build_object('shift_id',$1)
           FROM app.user_roles ur JOIN app.users u ON u.id = ur.user_id
           WHERE ur.role_code = 'ADMIN' LIMIT 1
           RETURNING *`,
          [r.id, `Shift ${r.id} has been open past ${staleOpen}h with an offline tracker.`],
        );
        if (inserted.rows[0]) created.push(inserted.rows[0]);
      }
      logger.info("stale-shift sweep", { flagged: res.rowCount });
    });
    // Real-time: surface the new admin notification in the gateway (07 §3/§5).
    for (const n of created) {
      if (n.recipient_user_id) {
        await this.publisher?.publish(RealtimeChannels.notifications, { userId: n.recipient_user_id, notification: n });
      }
    }
    logger.info("stale-shift sweep", { flagged: created.length });
    return { flagged: created.length };
  }
}
