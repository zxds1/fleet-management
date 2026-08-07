// packages/shared/src/config.ts
// Typed system_config keys (C2.4). The key unions are generated from db/seed/01_seed.sql
// so a new threshold forces a compile error at every use site (no magic numbers).
// The live client lives in @fleet/api (reads app.system_config + Redis cache); this
// interface is the contract every service depends on.

export type NumericConfigKey =
  | "tracker.offline_threshold_minutes"
  | "tracker.gap_interpolate_max_minutes"
  | "tracker.phone_fallback_prompt_minutes"
  | "telemetry.moving_speed_kph"
  | "telemetry.retain_buffer_minutes"
  | "speed.limit_kph"
  | "shift.overrun_warning_hours"
  | "shift.max_duty_hours"
  | "shift.stale_open_hours"
  | "shift.stale_tracker_offline_hours"
  | "shift.work_plan_max_photos"
  | "geofence.idle_minutes_before_autoclockout"
  | "geofence.autoclockout_countdown_minutes"
  | "fuel.anomaly_gauge_deviation_pct"
  | "fuel.gauge_photo_window_minutes"
  | "fuel.efficiency_deviation_pct"
  | "fuel.efficiency_rolling_shifts"
  | "fuel.efficiency_min_sample"
  | "fuel.price_outlier_pct"
  | "expense.high_value_alert_amount"
  | "hos.warning_lead_minutes"
  | "accident.telemetry_freeze_before_minutes"
  | "accident.telemetry_freeze_after_minutes"
  | "accident.ack_timeout_minutes"
  | "maintenance.auto_quarantine_enabled"
  | "maintenance.overdue_km_threshold"
  | "maintenance.due_soon_km"
  | "maintenance.due_soon_days"
  | "documents.warn_days_before"
  | "documents.daily_alert_days_before"
  | "sms.max_per_incident_per_15min"
  | "push.provider"
  | "retention.location_raw_days"
  | "retention.work_plan_days"
  | "retention.inspection_days"
  | "retention.receipt_days"
  | "retention.accident_days"
  | "retention.audit_days"
  | "auth.device_offline_max_hours"
  | "auth.offline_pin_lockout_attempts"
  | "auth.offline_pin_wipe_attempts"
  | "auth.offline_pin_lockout_minutes"
  | "auth.max_concurrent_sessions"
  | "locale.timezone"
  | "locale.currency";

export type StringConfigKey =
  | "accident.emergency_police_number"
  | "accident.emergency_ambulance_number"
  | "accident.fleet_manager_direct_number"
  | "escalation.head_of_operations_user_id";

export type BooleanConfigKey = "maintenance.auto_quarantine_enabled";

export interface ConfigClient {
  numeric(key: NumericConfigKey, defaultOverride?: number): Promise<number>;
  string(key: StringConfigKey, defaultOverride?: string | null): Promise<string | null>;
  boolean(key: BooleanConfigKey, defaultOverride?: boolean): Promise<boolean>;
}

// Default values mirror db/seed/01_seed.sql so a fresh DB is always usable.
export const CONFIG_DEFAULTS: Record<string, number | string | boolean> = {
  "tracker.offline_threshold_minutes": 15,
  "telemetry.moving_speed_kph": 3,
  "speed.limit_kph": 80,
  "shift.max_duty_hours": 14,
  "shift.overrun_warning_hours": 12,
  "fuel.anomaly_gauge_deviation_pct": 20,
  "fuel.efficiency_deviation_pct": 20,
  "fuel.efficiency_rolling_shifts": 30,
  "fuel.efficiency_min_sample": 5,
  "accident.ack_timeout_minutes": 5,
  "auth.max_concurrent_sessions": 10,
  "auth.device_offline_max_hours": 24,
  "retention.location_raw_days": 90,
};
