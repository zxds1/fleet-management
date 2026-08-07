-- =============================================================================
-- 11_views.sql
-- Fleet Management Platform - Read models for the live map, the admin inboxes
--                             and the reporting module
--
-- Decisions: B6, B10, C2.5, C2.9, C2.10, C6.1, N5, 2.7, 2.8
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.v_vehicle_display_state  (N5, 1.5, B10)
-- -----------------------------------------------------------------------------
-- The locked marker legend with its precedence order:
--   QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED
--
-- This resolves two defects in the original specification: Yellow meant both
-- "speeding" and "approaching HOS", and there was no state at all for a healthy
-- parked vehicle or for a tracker that has stopped reporting.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_vehicle_display_state AS
WITH cfg AS (
    SELECT
        app.fn_config_numeric('tracker.offline_threshold_minutes', 15) AS offline_minutes,
        app.fn_config_numeric('speed.limit_kph', 80)                   AS speed_limit_kph,
        app.fn_config_numeric('telemetry.moving_speed_kph', 3)         AS moving_speed_kph
),
open_shift AS (
    SELECT s.vehicle_id, s.id AS shift_id, s.driver_id, s.clock_in_at, s.is_overrun
    FROM app.shifts s
    WHERE s.state = 'OPEN'
)
SELECT
    v.id                                AS vehicle_id,
    v.license_plate,
    v.vehicle_class,
    v.status                            AS asset_status,
    v.is_operational,
    os.shift_id,
    os.driver_id,
    u.full_name                         AS driver_name,
    th.last_position,
    ST_Y(th.last_position::geometry)    AS latitude,
    ST_X(th.last_position::geometry)    AS longitude,
    th.last_position_at,
    th.last_speed_kph,
    th.last_ignition,
    th.is_online,
    hs.next_eligible_clock_in_at,
    hs.limit_reached_at,
    hs.warning_sent_at,
    CASE
        WHEN v.status = 'QUARANTINED'                                   THEN 'QUARANTINED'
        WHEN th.last_position_at IS NULL
          OR th.last_position_at < now() - make_interval(mins => cfg.offline_minutes::int)
                                                                        THEN 'OFFLINE'
        WHEN os.shift_id IS NOT NULL
         AND (hs.limit_reached_at IS NOT NULL OR hs.warning_sent_at IS NOT NULL
              OR os.is_overrun = true)                                  THEN 'HOS_ALERT'
        WHEN coalesce(th.last_speed_kph, 0) > cfg.speed_limit_kph       THEN 'SPEEDING'
        WHEN th.last_ignition = true
         AND coalesce(th.last_speed_kph, 0) > cfg.moving_speed_kph      THEN 'MOVING'
        WHEN th.last_ignition = true                                    THEN 'IDLING'
        ELSE 'PARKED'
    END::app.vehicle_display_state      AS display_state
FROM app.vehicles v
CROSS JOIN cfg
LEFT JOIN app.tracker_health   th ON th.vehicle_id = v.id
LEFT JOIN open_shift           os ON os.vehicle_id = v.id
LEFT JOIN app.drivers          d  ON d.id = os.driver_id
LEFT JOIN app.users            u  ON u.id = d.user_id
LEFT JOIN app.driver_hos_state hs ON hs.driver_id = os.driver_id
WHERE v.deleted_at IS NULL;

COMMENT ON VIEW app.v_vehicle_display_state IS
    'N5. Single source of truth for the live-map marker. Precedence: QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED.';

-- -----------------------------------------------------------------------------
-- app.v_dispatchable_vehicles / app.v_dispatchable_trailers  (3.4, 3.5, C1.8)
-- -----------------------------------------------------------------------------
-- An asset is dispatchable only when it is AVAILABLE, operational (documents
-- valid) and not quarantined. These two conditions are independent by design:
-- clearing a quarantine must not silently unblock an expired insurance.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_dispatchable_vehicles AS
SELECT
    v.id, v.license_plate, v.vehicle_class, v.make, v.model,
    v.fuel_tank_capacity_litres, v.current_odometer_km, v.home_geofence_id,
    v.tracker_imei, th.is_online AS tracker_online
FROM app.vehicles v
LEFT JOIN app.tracker_health th ON th.vehicle_id = v.id
WHERE v.deleted_at IS NULL
  AND v.status = 'AVAILABLE'
  AND v.is_operational = true;

CREATE OR REPLACE VIEW app.v_dispatchable_trailers AS
SELECT
    t.id, t.license_plate, t.trailer_type, t.length_ft, t.capacity_weight_kg,
    t.reefer_target_temp_min_c, t.reefer_target_temp_max_c
FROM app.trailers t
WHERE t.deleted_at IS NULL
  AND t.status = 'AVAILABLE'
  AND t.is_operational = true
  AND t.merged_into_trailer_id IS NULL;

-- -----------------------------------------------------------------------------
-- app.v_shift_verification_inbox  (2.7)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_shift_verification_inbox AS
SELECT
    s.id                            AS shift_id,
    s.operational_date,
    s.verification_status,
    s.state,
    s.is_overrun,
    s.tracker_reliability,
    d.id                            AS driver_id,
    u.full_name                     AS driver_name,
    v.id                            AS vehicle_id,
    v.license_plate                 AS vehicle_plate,
    tr.license_plate                AS trailer_plate,
    s.clock_in_at,
    s.clock_out_at,
    s.clock_out_source,
    s.shift_duration_seconds,
    s.driving_duration_seconds,
    s.total_distance_km,
    s.distance_source,
    s.start_odometer_km,
    s.end_odometer_km,
    (SELECT count(*) FROM app.inspections i
      WHERE i.shift_id = s.id AND i.has_blocking_failure = true)   AS blocking_failures,
    (SELECT count(*) FROM app.inspections i
      WHERE i.shift_id = s.id AND i.has_warning_failure = true)    AS warning_failures,
    (SELECT count(*) FROM app.fuel_purchases fp
      WHERE fp.shift_id = s.id)                                    AS fuel_purchase_count,
    (SELECT count(*) FROM app.fuel_purchase_anomalies a
      WHERE a.shift_id = s.id AND a.resolved_at IS NULL)           AS open_anomalies,
    (SELECT count(*) FROM app.expenses e
      WHERE e.shift_id = s.id AND e.approval_status = 'PENDING')   AS pending_expenses,
    s.closeout_missing,
    s.flag_reason,
    s.locked_at
FROM app.shifts s
JOIN app.drivers  d  ON d.id = s.driver_id
JOIN app.users    u  ON u.id = d.user_id
JOIN app.vehicles v  ON v.id = s.vehicle_id
LEFT JOIN app.trailers tr ON tr.id = s.assigned_trailer_id
WHERE s.state <> 'OPEN';

-- -----------------------------------------------------------------------------
-- app.v_fuel_reconciliation_inbox  (2.7, 2.5)
-- -----------------------------------------------------------------------------
-- Feeds the split-screen receipt review. Includes the gauge delta the anomaly
-- engine used, so the Admin sees the same evidence the machine did.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_fuel_reconciliation_inbox AS
SELECT
    fp.id                           AS fuel_purchase_id,
    fp.purchased_at,
    fp.entry_source,
    v.id                            AS vehicle_id,
    v.license_plate                 AS vehicle_plate,
    v.fuel_tank_capacity_litres,
    u.full_name                     AS driver_name,
    fp.litres,
    fp.total_cost,
    fp.currency,
    fp.unit_price,
    fp.odometer_km,
    fp.fuel_card_last_four,
    fc.label                        AS fuel_card_label,
    fc.is_pooled                    AS fuel_card_pooled,
    fc.expires_on                   AS fuel_card_expires_on,
    fp.receipt_media_object_id,
    fp.ocr_status,
    fp.ocr_litres,
    fp.ocr_total_cost,
    fp.ocr_confidence,
    before_r.gauge_percent          AS gauge_before_percent,
    after_r.gauge_percent           AS gauge_after_percent,
    (after_r.gauge_percent - before_r.gauge_percent)              AS gauge_delta_percent,
    round((fp.litres / NULLIF(v.fuel_tank_capacity_litres, 0)) * 100, 2)
                                                                  AS expected_gauge_rise_percent,
    fp.admin_verified,
    fp.rejected_at,
    fp.cleared_for_payment_at,
    (SELECT count(*) FROM app.fuel_purchase_anomalies a
      WHERE a.fuel_purchase_id = fp.id AND a.resolved_at IS NULL)  AS open_anomalies,
    (SELECT max(a.severity)::text FROM app.fuel_purchase_anomalies a
      WHERE a.fuel_purchase_id = fp.id AND a.resolved_at IS NULL)  AS worst_open_severity
FROM app.fuel_purchases fp
JOIN app.vehicles v         ON v.id = fp.vehicle_id
LEFT JOIN app.drivers   d   ON d.id = fp.driver_id
LEFT JOIN app.users     u   ON u.id = d.user_id
LEFT JOIN app.fuel_cards fc ON fc.id = fp.fuel_card_id
LEFT JOIN app.fuel_records before_r ON before_r.id = fp.before_fuel_record_id
LEFT JOIN app.fuel_records after_r  ON after_r.id  = fp.after_fuel_record_id;

-- -----------------------------------------------------------------------------
-- app.v_driver_hos_summary  (N7, C3.3)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_driver_hos_summary AS
SELECT
    d.id                                AS driver_id,
    u.full_name                         AS driver_name,
    d.status                            AS driver_status,
    p.name                              AS policy_name,
    p.max_driving_seconds_per_day,
    p.continuous_driving_before_break_seconds,
    p.min_break_seconds,
    hs.driving_seconds_today,
    hs.duty_seconds_today,
    hs.driving_seconds_since_break,
    hs.last_break_ended_at,
    hs.next_eligible_clock_in_at,
    hs.block_reason,
    hs.weekly_rest_satisfied,
    (hs.next_eligible_clock_in_at IS NOT NULL
     AND hs.next_eligible_clock_in_at > now())      AS is_rest_blocked,
    GREATEST(p.max_driving_seconds_per_day - hs.driving_seconds_today, 0)
                                                    AS driving_seconds_remaining,
    hs.computed_at
FROM app.drivers d
JOIN app.users u ON u.id = d.user_id
LEFT JOIN app.driver_hos_state hs ON hs.driver_id = d.id
LEFT JOIN app.hos_policies p
       ON p.id = COALESCE(hs.policy_id, d.hos_policy_id,
                          (SELECT id FROM app.hos_policies WHERE is_default LIMIT 1))
WHERE d.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- app.v_monthly_fuel_report  (2.8, C2.9, C2.10)
-- -----------------------------------------------------------------------------
-- Columns exactly as specified: Vehicle, Total Litres, Total Cost,
-- Average Cost/Litre, Total KM, Average L/100km, Cost per KM.
-- C2.9: Phase 1 cost per km is fuel only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_monthly_fuel_report AS
WITH purchases AS (
    SELECT
        fp.vehicle_id,
        date_trunc('month', fp.purchased_at AT TIME ZONE 'Africa/Nairobi')::date AS month_start,
        sum(fp.litres)      AS total_litres,
        sum(fp.total_cost)  AS total_cost,
        min(fp.currency)    AS currency
    FROM app.fuel_purchases fp
    WHERE fp.rejected_at IS NULL
    GROUP BY 1, 2
),
distance AS (
    SELECT
        s.vehicle_id,
        date_trunc('month', s.clock_in_at AT TIME ZONE 'Africa/Nairobi')::date AS month_start,
        sum(s.total_distance_km) AS total_km,
        count(*)                 AS shift_count
    FROM app.shifts s
    WHERE s.state = 'CLOSED'
      AND s.total_distance_km IS NOT NULL
    GROUP BY 1, 2
),
-- Union of every (vehicle, month) key so a month with distance but no purchase
-- (or the reverse) still produces a reportable row.
keys AS (
    SELECT vehicle_id, month_start FROM purchases
    UNION
    SELECT vehicle_id, month_start FROM distance
)
SELECT
    v.id                                        AS vehicle_id,
    v.license_plate,
    k.month_start,
    COALESCE(p.total_litres, 0)                 AS total_litres_purchased,
    COALESCE(p.total_cost, 0)                   AS total_cost,
    COALESCE(p.currency, 'KES')                 AS currency,
    CASE WHEN COALESCE(p.total_litres, 0) > 0
         THEN round(p.total_cost / p.total_litres, 4) END        AS average_cost_per_litre,
    COALESCE(dt.total_km, 0)                    AS total_km_driven,
    CASE WHEN COALESCE(dt.total_km, 0) > 0
         THEN round((COALESCE(p.total_litres, 0) / dt.total_km) * 100, 2) END
                                                AS average_l_per_100km,
    CASE WHEN COALESCE(dt.total_km, 0) > 0
         THEN round(COALESCE(p.total_cost, 0) / dt.total_km, 4) END
                                                AS cost_per_km,
    COALESCE(dt.shift_count, 0)                 AS shift_count
FROM keys k
JOIN app.vehicles v ON v.id = k.vehicle_id AND v.deleted_at IS NULL
LEFT JOIN purchases p ON p.vehicle_id = k.vehicle_id AND p.month_start = k.month_start
LEFT JOIN distance  dt ON dt.vehicle_id = k.vehicle_id AND dt.month_start = k.month_start;

COMMENT ON VIEW app.v_monthly_fuel_report IS
    '2.8. Backing view for GET /reports/fuel/monthly. Cost per km is fuel-only in Phase 1 (C2.9).';

-- -----------------------------------------------------------------------------
-- app.v_payroll_export  (C2.5)
-- -----------------------------------------------------------------------------
-- Exactly the columns Finance asked for. Only CLOSED shifts appear; the
-- Verified and Flagged columns let Finance decide what to pay.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_payroll_export AS
SELECT
    u.full_name                                             AS driver,
    d.employee_number,
    v.license_plate                                         AS vehicle,
    s.operational_date                                      AS shift_date,
    round(COALESCE(s.shift_duration_seconds, 0) / 3600.0, 2)    AS total_hours,
    round(COALESCE(s.driving_duration_seconds, 0) / 3600.0, 2)  AS driving_hours,
    COALESCE(s.total_distance_km, 0)                        AS total_km,
    (s.verification_status = 'VERIFIED')                    AS verified,
    (s.verification_status = 'FLAGGED')                     AS flagged,
    s.tracker_reliability,
    s.id                                                    AS shift_id
FROM app.shifts s
JOIN app.drivers  d ON d.id = s.driver_id
JOIN app.users    u ON u.id = d.user_id
JOIN app.vehicles v ON v.id = s.vehicle_id
WHERE s.state = 'CLOSED';

-- -----------------------------------------------------------------------------
-- app.v_open_anomalies  (5.x Anomalies tab)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_open_anomalies AS
SELECT 'FUEL'::text AS domain, a.id, a.severity::text, a.anomaly_type::text AS kind,
       a.vehicle_id, a.driver_id, a.detected_at, a.detail
FROM app.fuel_purchase_anomalies a
WHERE a.resolved_at IS NULL
UNION ALL
SELECT 'HOS', hv.id, 'CRITICAL', hv.violation_type::text,
       s.vehicle_id, hv.driver_id, hv.detected_at,
       jsonb_build_object('threshold_seconds', hv.threshold_seconds,
                          'actual_seconds', hv.actual_seconds)
FROM app.hos_violations hv
LEFT JOIN app.shifts s ON s.id = hv.shift_id
WHERE hv.acknowledged_at IS NULL
UNION ALL
SELECT 'ACCIDENT', ar.id,
       CASE WHEN ar.is_mayday THEN 'CRITICAL' ELSE 'WARNING' END,
       'ACCIDENT_' || ar.status::text,
       ar.vehicle_id, ar.driver_id, ar.reported_at,
       jsonb_build_object('is_mayday', ar.is_mayday,
                          'acknowledged', ar.acknowledged_at IS NOT NULL)
FROM app.accident_reports ar
WHERE ar.status IN ('PENDING','INVESTIGATING')
UNION ALL
SELECT 'MAINTENANCE', ms.id, 'WARNING', 'MAINTENANCE_' || ms.status::text,
       ms.vehicle_id, NULL, ms.evaluated_at,
       jsonb_build_object('overdue_by_km', ms.overdue_by_km,
                          'overdue_by_days', ms.overdue_by_days)
FROM app.maintenance_schedules ms
WHERE ms.status = 'OVERDUE'
UNION ALL
SELECT 'SECURITY', vme.id, 'WARNING', vme.event_type,
       vme.vehicle_id, NULL, vme.occurred_at,
       jsonb_build_object('duration_seconds', vme.duration_seconds)
FROM app.vehicle_movement_events vme
WHERE vme.acknowledged_at IS NULL;

COMMENT ON VIEW app.v_open_anomalies IS
    'Unified feed for the Anomalies and Accidents screen: fuel, HOS, accidents, maintenance and off-shift movement.';
