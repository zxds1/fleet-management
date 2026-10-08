/**
 * `system_config` keys, mirrored from `fleet-management/packages/shared/src/config.ts` (generated
 * from `db/seed/01_seed.sql`). The unions are the contract: adding a threshold server-side forces a
 * decision here rather than being silently ignored.
 *
 * There is no `GET /config` endpoint. The server reads these itself (they gate the write, e.g. the
 * HOS rest block); the app only needs the handful that shape a local decision, and it hard-codes the
 * seeded defaults so a safety rule never depends on a network round-trip.
 */

export type NumericConfigKey =
  | 'tracker.offline_threshold_minutes'
  | 'tracker.gap_interpolate_max_minutes'
  | 'tracker.phone_fallback_prompt_minutes'
  | 'telemetry.moving_speed_kph'
  | 'telemetry.retain_buffer_minutes'
  | 'speed.limit_kph'
  | 'shift.overrun_warning_hours'
  | 'shift.max_duty_hours'
  | 'shift.stale_open_hours'
  | 'shift.stale_tracker_offline_hours'
  | 'shift.work_plan_max_photos'
  | 'geofence.idle_minutes_before_autoclockout'
  | 'geofence.autoclockout_countdown_minutes'
  | 'fuel.anomaly_gauge_deviation_pct'
  | 'fuel.gauge_photo_window_minutes'
  | 'fuel.efficiency_deviation_pct'
  | 'fuel.efficiency_rolling_shifts'
  | 'fuel.efficiency_min_sample'
  | 'fuel.price_outlier_pct'
  | 'expense.high_value_alert_amount'
  | 'hos.warning_lead_minutes'
  | 'accident.telemetry_freeze_before_minutes'
  | 'accident.telemetry_freeze_after_minutes'
  | 'accident.ack_timeout_minutes'
  | 'maintenance.overdue_km_threshold'
  | 'maintenance.due_soon_km'
  | 'maintenance.due_soon_days'
  | 'documents.warn_days_before'
  | 'documents.daily_alert_days_before'
  | 'sms.max_per_incident_per_15min'
  | 'retention.location_raw_days'
  | 'retention.work_plan_days'
  | 'retention.inspection_days'
  | 'retention.receipt_days'
  | 'retention.accident_days'
  | 'retention.audit_days'
  | 'auth.device_offline_max_hours'
  | 'auth.offline_pin_lockout_attempts'
  | 'auth.offline_pin_wipe_attempts'
  | 'auth.offline_pin_lockout_minutes'
  | 'auth.max_concurrent_sessions';

export type StringConfigKey =
  | 'accident.emergency_police_number'
  | 'accident.emergency_ambulance_number'
  | 'accident.fleet_manager_direct_number'
  | 'escalation.head_of_operations_user_id'
  | 'locale.timezone'
  | 'locale.currency';

export type BooleanConfigKey = 'maintenance.auto_quarantine_enabled';

/** Seeded defaults (`db/seed/01_seed.sql`), mirrored verbatim. */
export const CONFIG_DEFAULTS = {
  'tracker.offline_threshold_minutes': 15,
  'telemetry.moving_speed_kph': 3,
  'speed.limit_kph': 80,
  'shift.max_duty_hours': 14,
  'shift.overrun_warning_hours': 12,
  'fuel.anomaly_gauge_deviation_pct': 20,
  'fuel.efficiency_deviation_pct': 20,
  'fuel.efficiency_rolling_shifts': 30,
  'fuel.efficiency_min_sample': 5,
  'accident.ack_timeout_minutes': 5,
  'documents.warn_days_before': 30,
  'auth.max_concurrent_sessions': 10,
  'auth.device_offline_max_hours': 24,
  'auth.offline_pin_lockout_attempts': 5,
  'auth.offline_pin_wipe_attempts': 10,
  'auth.offline_pin_lockout_minutes': 15,
  'retention.location_raw_days': 90,
  'locale.timezone': 'Africa/Nairobi',
  'locale.currency': 'KES',
} as const satisfies Record<string, number | string | boolean>;

/** Minimum receipt-OCR confidence (0-1) below which the review UI raises a low-confidence banner. */
export const OCR_CONFIDENCE_THRESHOLD = 0.7;

export class ConfigKeyError extends Error {
  constructor(key: string) {
    super(`Unknown config key: ${key}`);
    this.name = 'ConfigKeyError';
  }
}

/**
 * The server's ConfigClient is async (PG + Redis). The app's is synchronous and seeded with the
 * values above: a safety rule such as the offline ceiling or the PIN lockout must work with no
 * network at all. `update()` exists so a future server-sourced override can be merged in.
 */
export class ConfigClient {
  private readonly values = new Map<string, number | string | boolean>();

  constructor(private readonly defaults: Record<string, number | string | boolean> = CONFIG_DEFAULTS) {}

  /** Merge server values. Unknown keys are kept (the server may add thresholds before the app knows them). */
  update(values: Record<string, unknown> | null | undefined): void {
    for (const [k, v] of Object.entries(values ?? {})) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') this.values.set(k, v);
    }
  }

  has(key: string): boolean {
    return this.values.has(key) || key in this.defaults;
  }

  private raw(key: string): number | string | boolean {
    if (this.values.has(key)) return this.values.get(key)!;
    if (key in this.defaults) return this.defaults[key]!;
    throw new ConfigKeyError(key);
  }

  /** A bad server value falls back to the default rather than breaking a safety rule. */
  numeric(key: NumericConfigKey): number {
    const v = this.raw(key);
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
    const d = this.defaults[key];
    if (typeof d === 'number') return d;
    throw new ConfigKeyError(key);
  }

  string(key: StringConfigKey): string {
    const v = this.raw(key);
    return typeof v === 'string' ? v : String(v);
  }

  boolean(key: BooleanConfigKey): boolean {
    const v = this.raw(key);
    return typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : Boolean(v);
  }
}