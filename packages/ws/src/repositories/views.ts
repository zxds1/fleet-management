// packages/ws/src/repositories/views.ts
// Read-only projections the gateway recomputes server-side (07 §3). The gateway holds no system of
// record; every payload is derived from PG here. Parameterised SQL only (06 §2).

import type {
  DbClient,
  NotificationRow,
  VehicleDisplayStateViewRow,
} from "@fleet/shared";

export class VehicleStateRepository {
  constructor(private readonly client: DbClient) {}

  /** Full snapshot of derived vehicle display state (N5 precedence, 08 §6). */
  async snapshot(): Promise<VehicleDisplayStateViewRow[]> {
    const res = await this.client.query<VehicleDisplayStateViewRow>(
      `SELECT * FROM app.v_vehicle_display_state`,
    );
    return res.rows;
  }
}

export class NotificationRepository {
  constructor(private readonly client: DbClient) {}

  /** Outstanding (unread) notifications for a user — the (re)connect snapshot (07 §5). */
  async unread(userId: string, limit = 100): Promise<NotificationRow[]> {
    const res = await this.client.query<NotificationRow>(
      `SELECT *
         FROM app.notifications
        WHERE recipient_user_id = $1
          AND status IN ('QUEUED', 'SENT', 'DELIVERED')
        ORDER BY queued_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return res.rows;
  }
}

export class OnCallRepository {
  constructor(private readonly client: DbClient) {}

  /** True when the user is on the active accident on-call roster (C6.3 / 07 §3). */
  async isAccidentOnCall(userId: string): Promise<boolean> {
    const res = await this.client.query<{ id: string }>(
      `SELECT id
         FROM app.on_call_roster
        WHERE user_id = $1
          AND incident_kind = 'accident'
          AND is_active = true
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        LIMIT 1`,
      [userId],
    );
    return res.rows.length > 0;
  }
}
