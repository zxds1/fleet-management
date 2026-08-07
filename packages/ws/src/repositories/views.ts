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

export interface DriverContext {
  vehicleId: string | null;
  shiftId: string | null;
}

export interface DriverShiftState {
  shiftId: string;
  state: string | null;
  vehicleId: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
}

/** Driver-scoped projections for the driver realtime surface (07 §3/§5, D-3). */
export class DriverRepository {
  constructor(private readonly client: DbClient) {}

  /**
   * The driver's currently-open (or pending-closeout) assignment — the scope the gateway joins the
   * `driver:shift` / `driver:vehicle` rooms from. Returns nulls when the driver has no active shift.
   */
  async activeContext(userId: string): Promise<DriverContext> {
    const res = await this.client.query<{ vehicle_id: string | null; shift_id: string | null }>(
      `SELECT vehicle_id, shift_id
         FROM app.v_shift_verification_inbox
        WHERE driver_id = $1
          AND state IN ('OPEN', 'PENDING_CLOSEOUT')
        ORDER BY clock_in_at DESC
        LIMIT 1`,
      [userId],
    );
    const row = res.rows[0];
    return { vehicleId: row?.vehicle_id ?? null, shiftId: row?.shift_id ?? null };
  }

  /** The driver's own vehicle display state — emitted on (re)connect and on change (07 §5). */
  async vehicleState(vehicleId: string): Promise<VehicleDisplayStateViewRow | null> {
    const res = await this.client.query<VehicleDisplayStateViewRow>(
      `SELECT * FROM app.v_vehicle_display_state WHERE vehicle_id = $1`,
      [vehicleId],
    );
    return res.rows[0] ?? null;
  }

  /** The driver's active shift summary (clock-in/out, state) for the `driver:shift` snapshot. */
  async shiftState(shiftId: string): Promise<DriverShiftState | null> {
    const res = await this.client.query<DriverShiftState>(
      `SELECT shift_id,
              state,
              vehicle_id,
              clock_in_at,
              clock_out_at
         FROM app.v_shift_verification_inbox
        WHERE shift_id = $1
        LIMIT 1`,
      [shiftId],
    );
    return res.rows[0] ?? null;
  }
}
