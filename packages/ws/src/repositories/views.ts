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

/** The driver's own scope: their driver id plus the vehicle they are currently bound to. */
export interface DriverScope {
  driverId: string;
  vehicleId: string | null;
}

/** The driver's live shift state — the (re)connect snapshot for `driver:shift` (07 §5). */
export interface DriverShiftState {
  shift_id: string | null;
  state: string | null;
  operational_date: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  vehicle_id: string | null;
  is_overrun: boolean | null;
  next_eligible_clock_in_at: string | null;
}

export class DriverRepository {
  constructor(private readonly client: DbClient) {}

  /**
   * Resolves the driver behind a user and the vehicle to scope their real-time to: the vehicle of
   * the OPEN shift when one exists, otherwise the most recent dispatch assignment (the same
   * precedence `GET /drivers/me/assignment` uses).
   */
  async scopeForUser(userId: string): Promise<DriverScope | null> {
    const res = await this.client.query<{ driver_id: string; vehicle_id: string | null }>(
      `SELECT d.id AS driver_id,
              COALESCE(s.vehicle_id, a.vehicle_id) AS vehicle_id
         FROM app.drivers d
         LEFT JOIN LATERAL (
             SELECT sh.vehicle_id
               FROM app.shifts sh
              WHERE sh.driver_id = d.id AND sh.state = 'OPEN'
              ORDER BY sh.clock_in_at DESC
              LIMIT 1
         ) s ON true
         LEFT JOIN LATERAL (
             SELECT asg.vehicle_id
               FROM app.assignments asg
              WHERE asg.driver_id = d.id
              ORDER BY asg.assigned_date DESC, asg.created_at DESC
              LIMIT 1
         ) a ON true
        WHERE d.user_id = $1::uuid AND d.deleted_at IS NULL
        LIMIT 1`,
      [userId],
    );
    const row = res.rows[0];
    return row ? { driverId: row.driver_id, vehicleId: row.vehicle_id } : null;
  }

  /** The driver's own vehicle display-state row — same view the admin map reads, scoped (07 §3). */
  async vehicleState(vehicleId: string): Promise<VehicleDisplayStateViewRow | null> {
    const res = await this.client.query<VehicleDisplayStateViewRow>(
      `SELECT * FROM app.v_vehicle_display_state WHERE vehicle_id = $1::uuid LIMIT 1`,
      [vehicleId],
    );
    return res.rows[0] ?? null;
  }

  /** The driver's current (or most recent) shift plus their HOS re-eligibility instant. */
  async shiftState(driverId: string): Promise<DriverShiftState | null> {
    const res = await this.client.query<DriverShiftState>(
      `SELECT s.id                AS shift_id,
              s.state::text       AS state,
              s.operational_date::text AS operational_date,
              s.clock_in_at,
              s.clock_out_at,
              s.vehicle_id,
              s.is_overrun,
              hs.next_eligible_clock_in_at
         FROM app.shifts s
         LEFT JOIN app.driver_hos_state hs ON hs.driver_id = s.driver_id
        WHERE s.driver_id = $1::uuid
        ORDER BY (s.state = 'OPEN') DESC, s.clock_in_at DESC
        LIMIT 1`,
      [driverId],
    );
    return res.rows[0] ?? null;
  }
}
