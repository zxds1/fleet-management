-- =============================================================================
-- 01_seed.sql
-- Fleet Management Platform - Reference data seed
--
-- Idempotent. Safe to run on every deployment.
--
-- IMPORTANT (see risk register R-011 and R-014):
--   * The HOS figures below are the client-stated NTSA interpretation. They must
--     be confirmed by Kenyan transport counsel before go-live.
--   * The DVIR BLOCKER/WARNING severities below are architectural defaults.
--     C1.5 makes them Admin-configurable; the fleet safety officer must review
--     them before the first live shift.
--   * Swahili strings are provisional and require native-speaker review.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- Roles  (C6.1, N4)
-- -----------------------------------------------------------------------------
INSERT INTO app.roles (code, name, description, requires_mfa) VALUES
    ('DRIVER',        'Driver',        'Clock in/out, submit inspections, fuel, expenses and accident reports.', false),
    ('DISPATCHER',    'Dispatcher',    'Assign assets, view the live map and read shift data.',                   false),
    ('FLEET_MANAGER', 'Fleet Manager', 'Dispatcher rights plus verification, quarantine and data overrides.',     false),
    ('ADMIN',         'Administrator', 'Full system access including user management and audit logs.',            false),
    ('FINANCE',       'Finance',       'Read-only financial access; may clear verified receipts for payment.',    false),
    ('AUDITOR',       'Auditor',       'Read-only access to all data including the audit trail.',                 false)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
INSERT INTO app.permissions (code, description, phase) VALUES
    -- Operations (Phase 1)
    ('shift:clock_in',          'Start a shift',                                        1),
    ('shift:clock_out',         'End own shift',                                        1),
    ('shift:read_own',          'Read own shift history',                               1),
    ('shift:read_all',          'Read all shifts',                                      1),
    ('shift:verify',            'Verify and lock a shift for payroll',                  1),
    ('shift:flag',              'Flag a shift back to the driver',                      1),
    ('shift:unlock',            'Unlock a verified shift for correction (B18)',         1),
    ('shift:force_close',       'Force-close an open or overrun shift (N6)',            1),
    ('inspection:submit',       'Submit a DVIR',                                        1),
    ('inspection:read',         'Read DVIR results',                                    1),
    ('inspection:template_manage','Create and publish inspection templates (C1.4)',     1),
    ('trailer:swap',            'Perform a mid-shift hook/drop',                        1),
    ('assignment:read',         'Read dispatch assignments',                            1),
    ('assignment:create',       'Create dispatch assignments',                          1),
    ('assignment:update',       'Modify or cancel dispatch assignments',                1),
    ('asset:read',              'Read vehicles and trailers',                           1),
    ('asset:create',            'Onboard vehicles and trailers',                        1),
    ('asset:update',            'Edit vehicle and trailer master data',                 1),
    ('asset:quarantine',        'Quarantine an asset',                                  1),
    ('asset:lift_quarantine',   'Lift a quarantine (C3.9)',                             1),
    ('document:read',           'Read asset and driver documents',                      1),
    ('document:manage',         'Upload and replace documents',                         1),
    ('geofence:read',           'Read geofences',                                       1),
    ('geofence:manage',         'Draw and edit geofences',                              1),
    ('telemetry:read_live',     'Read the live map',                                    1),
    ('telemetry:read_history',  'Read historic tracks',                                 1),
    ('recovery:manage',         'Enable or disable vehicle recovery mode (N3.1)',       1),
    ('user:read',               'Read user accounts',                                   1),
    ('user:manage',             'Create, edit and deactivate users',                    1),
    ('role:manage',             'Grant and revoke roles',                               1),
    ('device:revoke',           'Revoke a driver device (B13)',                         1),
    ('manage_own_mfa',          'Enrol, confirm or disable own MFA (B12)',              1),
    ('revoke_device',           'Revoke own registered device (B12)',                   1),
    ('config:read',             'Read system configuration',                            1),
    ('config:manage',           'Change system configuration thresholds (C2.4)',        1),
    ('audit:read',              'Read the audit trail',                                 1),
    -- Financial (Phase 2)
    ('fuel:record_gauge',       'Submit a dashboard gauge photo',                       2),
    ('fuel:submit_purchase',    'Submit a fuel purchase',                               2),
    ('fuel:read',               'Read fuel records and purchases',                      2),
    ('fuel:verify',             'Verify or reject a fuel purchase',                     2),
    ('fuel:adjust',             'Adjust driver-entered fuel data',                      2),
    ('fuel:clear_payment',      'Mark a verified receipt cleared for payment (C6.1)',   2),
    ('fuel:card_manage',        'Manage the fuel card registry',                        2),
    ('fuel:reconcile',          'Upload and match card statements (A1.9)',              2),
    ('expense:submit',          'Submit an expense',                                    2),
    ('expense:read',            'Read expenses',                                        2),
    ('expense:approve',         'Approve or reject expenses',                           2),
    ('report:read',             'Read reports',                                         2),
    ('report:export',           'Export reports to CSV or PDF',                         2),
    ('payroll:export',          'Generate the payroll export (C2.5)',                   2),
    -- Safety (Phase 3)
    ('accident:report',         'Raise an SOS or accident report',                      3),
    ('accident:read',           'Read accident reports',                                3),
    ('accident:acknowledge',    'Acknowledge an accident (C6.3)',                       3),
    ('accident:update',         'Update accident investigation fields',                 3),
    ('accident:close',          'Resolve and close an accident',                        3),
    ('hos:read',                'Read hours-of-service state',                          3),
    ('hos:override',            'Assign a non-default HOS policy to a driver (C3.2)',   3),
    ('maintenance:read',        'Read maintenance schedules',                           3),
    ('maintenance:manage',      'Define maintenance tasks and intervals',               3),
    ('maintenance:record',      'Record completed maintenance',                         3),
    ('notification:manage',     'Manage templates and the on-call roster',              3)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Role -> permission mapping  (C6.1, C6.2 union semantics)
-- -----------------------------------------------------------------------------
INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'DRIVER', p FROM unnest(ARRAY[
    'shift:clock_in','shift:clock_out','shift:read_own',
    'inspection:submit','trailer:swap',
    'fuel:record_gauge','fuel:submit_purchase',
    'expense:submit','accident:report','hos:read','asset:read','assignment:read',
    'manage_own_mfa','revoke_device'
]) AS p
ON CONFLICT DO NOTHING;

INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'DISPATCHER', p FROM unnest(ARRAY[
    'asset:read','assignment:read','assignment:create','assignment:update',
    'telemetry:read_live','shift:read_all','inspection:read',
    'hos:read','document:read','geofence:read','accident:read'
]) AS p
ON CONFLICT DO NOTHING;

INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'FLEET_MANAGER', p FROM unnest(ARRAY[
    'asset:read','asset:create','asset:update','asset:quarantine','asset:lift_quarantine',
    'assignment:read','assignment:create','assignment:update',
    'telemetry:read_live','telemetry:read_history','recovery:manage',
    'shift:read_all','shift:verify','shift:flag','shift:unlock','shift:force_close',
    'inspection:read','inspection:template_manage',
    'fuel:read','fuel:verify','fuel:adjust','fuel:card_manage','fuel:reconcile',
    'expense:read','expense:approve',
    'accident:read','accident:acknowledge','accident:update','accident:close',
    'hos:read','hos:override',
    'maintenance:read','maintenance:manage','maintenance:record',
    'document:read','document:manage','geofence:read','geofence:manage',
    'report:read','report:export','config:read'
]) AS p
ON CONFLICT DO NOTHING;

-- C6.1: Finance is read-only over data, with the single write action of
-- clearing an already-verified receipt for payment.
INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'FINANCE', p FROM unnest(ARRAY[
    'fuel:read','fuel:clear_payment','expense:read',
    'shift:read_all','asset:read',
    'report:read','report:export','payroll:export'
]) AS p
ON CONFLICT DO NOTHING;

-- C6.1: Auditor is read-only everywhere, including the audit trail.
INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'AUDITOR', p FROM unnest(ARRAY[
    'audit:read','asset:read','assignment:read','shift:read_all','inspection:read',
    'fuel:read','expense:read','accident:read','hos:read','maintenance:read',
    'document:read','geofence:read','telemetry:read_history','report:read',
    'user:read','config:read'
]) AS p
ON CONFLICT DO NOTHING;

-- ADMIN receives every permission.
INSERT INTO app.role_permissions (role_code, permission_code)
SELECT 'ADMIN', code FROM app.permissions
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- System configuration  (C2.4 - every threshold in the platform)
-- -----------------------------------------------------------------------------
INSERT INTO app.system_config (key, value, value_type, description, min_value, max_value, unit, phase) VALUES
    -- Telemetry and the live map
    ('tracker.offline_threshold_minutes',        '15',   'number',  'Minutes without a position before a vehicle shows OFFLINE (N5).', 1, 240, 'minutes', 1),
    ('tracker.gap_interpolate_max_minutes',      '5',    'number',  'Telemetry gaps up to this length are interpolated for driving time (C1.9).', 0, 60, 'minutes', 1),
    ('tracker.phone_fallback_prompt_minutes',    '15',   'number',  'Offline duration before the app offers phone-GPS fallback (C1.9).', 1, 240, 'minutes', 1),
    ('telemetry.moving_speed_kph',               '3',    'number',  'Speed above which a vehicle counts as moving (spec 1.2).', 0, 20, 'km/h', 1),
    ('telemetry.retain_buffer_minutes',          '15',   'number',  'Location retained either side of a shift (N3.3).', 0, 120, 'minutes', 1),
    ('speed.limit_kph',                          '80',   'number',  'Global speeding threshold (B10).', 20, 140, 'km/h', 1),
    -- Shift lifecycle
    ('shift.overrun_warning_hours',              '12',   'number',  'Duty hours at which the overrun warning fires (C1.1).', 1, 24, 'hours', 1),
    ('shift.max_duty_hours',                     '14',   'number',  'Duty hours at which a shift is marked OVERRUN (N6). Does not auto-close.', 1, 24, 'hours', 1),
    ('shift.stale_open_hours',                   '14',   'number',  'Open-shift age that triggers the stale-shift sweep (C3.8).', 1, 72, 'hours', 1),
    ('shift.stale_tracker_offline_hours',        '4',    'number',  'Tracker offline duration required alongside a stale shift (C3.8).', 1, 48, 'hours', 1),
    ('shift.work_plan_max_photos',               '5',    'number',  'Maximum work-plan photographs (C1.13).', 1, 10, 'photos', 1),
    -- Geofence auto-clockout
    ('geofence.idle_minutes_before_autoclockout','15',   'number',  'Stationary minutes inside a yard before the countdown starts (A1.7).', 1, 120, 'minutes', 1),
    ('geofence.autoclockout_countdown_minutes',  '5',    'number',  'Countdown the driver may cancel (A1.7).', 1, 30, 'minutes', 1),
    -- Fuel
    ('fuel.anomaly_gauge_deviation_pct',         '20',   'number',  'Gauge-rise deviation that raises POSSIBLE_THEFT_OR_LEAK (2.5).', 1, 100, 'percent', 2),
    ('fuel.gauge_photo_window_minutes',          '30',   'number',  'Window around a purchase in which gauge photos are matched (2.5).', 1, 240, 'minutes', 2),
    ('fuel.efficiency_deviation_pct',            '20',   'number',  'Deviation from baseline that raises EFFICIENCY_DEVIATION (2.6).', 1, 100, 'percent', 2),
    ('fuel.efficiency_rolling_shifts',           '30',   'number',  'Rolling window for the per-vehicle baseline (B6).', 1, 200, 'shifts', 2),
    ('fuel.efficiency_min_sample',               '5',    'number',  'Minimum shifts before the per-vehicle baseline is used (B6).', 1, 50, 'shifts', 2),
    ('fuel.price_outlier_pct',                   '30',   'number',  'Unit-price deviation from the 30-day mean that raises PRICE_OUTLIER.', 1, 200, 'percent', 2),
    ('expense.high_value_alert_amount',          '5000', 'number',  'Expense amount above which an Admin alert fires (C2.7).', 0, 1000000, 'KES', 2),
    -- Hours of service (mirrors the default policy; used for display only)
    ('hos.warning_lead_minutes',                 '30',   'number',  'Lead time for the "rest break required" warning (3.2).', 1, 240, 'minutes', 3),
    -- Accident
    ('accident.telemetry_freeze_before_minutes', '5',    'number',  'Telemetry frozen before the report (C3.4).', 2, 10, 'minutes', 3),
    ('accident.telemetry_freeze_after_minutes',  '1',    'number',  'Telemetry frozen after the report (C3.4).', 0, 10, 'minutes', 3),
    ('accident.ack_timeout_minutes',             '5',    'number',  'Acknowledgement window before escalation (C6.3).', 1, 60, 'minutes', 3),
    ('accident.emergency_police_number',         '"112"','string',  'Police number offered in the emergency chooser (C3.5). VERIFY LOCALLY.', NULL, NULL, NULL, 3),
    ('accident.emergency_ambulance_number',      '"999"','string',  'Ambulance number offered in the emergency chooser (C3.5). VERIFY LOCALLY.', NULL, NULL, NULL, 3),
    ('accident.fleet_manager_direct_number',     'null', 'string',  'Direct fleet manager line offered in the emergency chooser (C3.5).', NULL, NULL, NULL, 3),
    ('escalation.head_of_operations_user_id',    'null', 'string',  'User who receives the five-minute accident escalation (C6.3).', NULL, NULL, NULL, 3),
    -- Maintenance and documents
    ('maintenance.auto_quarantine_enabled',      'false','boolean', 'Global switch for maintenance auto-quarantine (C3.12).', NULL, NULL, NULL, 3),
    ('maintenance.overdue_km_threshold',         '5000', 'number',  'Overdue distance at which auto-quarantine would apply (C3.12).', 100, 50000, 'km', 3),
    ('maintenance.due_soon_km',                  '1000', 'number',  'Distance before due at which a schedule shows DUE_SOON.', 50, 20000, 'km', 3),
    ('maintenance.due_soon_days',                '14',   'number',  'Days before due at which a schedule shows DUE_SOON.', 1, 180, 'days', 3),
    ('documents.warn_days_before',               '30',   'number',  'Lead time for the first expiry warning (3.5).', 1, 365, 'days', 1),
    ('documents.daily_alert_days_before',        '7',    'number',  'Point at which weekly digests become daily alerts (B8).', 1, 90, 'days', 1),
    -- Notifications
    ('sms.max_per_incident_per_15min',           '5',    'number',  'Africa''s Talking cost guard (A1.8).', 1, 50, 'messages', 1),
    ('push.provider',                            '"FCM"','string',  'Push transport (N9). FCM direct for delivery receipts.', NULL, NULL, NULL, 1),
    -- Retention (C5.3, M7)
    ('retention.location_raw_days',              '90',   'number',  'Raw GPS retention before summarise-and-drop (7.3).', 7, 3650, 'days', 1),
    ('retention.work_plan_days',                 '2557', 'number',  'Work-plan photo retention, raised to the payroll window (M7).', 30, 3650, 'days', 1),
    ('retention.inspection_days',                '2557', 'number',  'DVIR photo retention, raised to the payroll window (M7).', 365, 3650, 'days', 1),
    ('retention.receipt_days',                   '2557', 'number',  'Fuel and expense receipt retention (C5.3).', 365, 3650, 'days', 2),
    ('retention.accident_days',                  '2557', 'number',  'Accident evidence retention, enforced by S3 Object Lock (C5.3).', 2557, 7300, 'days', 3),
    ('retention.audit_days',                     '2557', 'number',  'Audit trail retention (C6.5).', 2557, 7300, 'days', 1),
    -- Security
    ('auth.max_concurrent_sessions',            '10',   'number',  'Concurrent admin sessions per user (A1.6).', 1, 50, 'sessions', 1),
    -- Localisation
    ('locale.timezone',                          '"Africa/Nairobi"', 'string', 'Operational timezone (A2.3).', NULL, NULL, NULL, 1),
    ('locale.currency',                          '"KES"', 'string', 'Default currency (A2.2).', NULL, NULL, NULL, 1)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Default HOS policy  (C3.1)
-- REVIEW REQUIRED: these figures are the client's stated NTSA interpretation.
-- -----------------------------------------------------------------------------
INSERT INTO app.hos_policies (
    name, is_default,
    max_driving_seconds_per_day, max_duty_seconds_per_shift, duty_warning_seconds,
    continuous_driving_before_break_seconds, min_break_seconds,
    min_daily_rest_seconds, min_weekly_rest_seconds, weekly_window_days,
    warning_lead_seconds, notes
)
SELECT
    'NTSA Default', true,
    8 * 3600,     -- 8 h driving per day
    14 * 3600,    -- 14 h duty per shift
    12 * 3600,    -- warn at 12 h
    4 * 3600,     -- break after 4 h continuous driving
    30 * 60,      -- 30-minute break
    10 * 3600,    -- 10 h daily rest
    24 * 3600,    -- 24 h weekly rest
    7,
    30 * 60,      -- "rest break required in 30 minutes"
    'Client-stated NTSA interpretation. Pending legal confirmation - see risk register R-011.'
WHERE NOT EXISTS (SELECT 1 FROM app.hos_policies WHERE is_default = true);

-- -----------------------------------------------------------------------------
-- Inspection templates  (C1.4, C1.5, C1.6, A2.6, M6)
-- Severities are defaults for the safety officer to review (risk register R-014).
-- -----------------------------------------------------------------------------
INSERT INTO app.inspection_templates (code, name, subject, version, is_active, published_at)
VALUES
    ('DVIR_TRACTOR_V1', 'Pre-Shift Tractor Inspection', 'VEHICLE',      1, true, now()),
    ('DVIR_TRAILER_V1', 'Pre-Shift Trailer Inspection', 'TRAILER',      1, true, now()),
    ('SWAP_TRAILER_V1', 'Mid-Shift Trailer Hook Check', 'TRAILER_SWAP', 1, true, now())
ON CONFLICT (code, version) DO NOTHING;

-- Tractor checklist (spec 1.1)
INSERT INTO app.inspection_template_items
    (template_id, code, label_en, label_sw, severity, input_type, sequence)
SELECT t.id, x.code, x.label_en, x.label_sw, x.severity::app.inspection_severity, 'PASS_FAIL', x.seq
FROM app.inspection_templates t
CROSS JOIN (VALUES
    ('TIRES',      'Tyres (pressure and tread)',              'Matairi (mgandamizo na nyayo)',            'BLOCKER', 1),
    ('LIGHTS',     'Headlights, taillights and indicators',   'Taa za mbele, nyuma na viashiria',         'BLOCKER', 2),
    ('BRAKES',     'Brake functionality',                     'Utendaji wa breki',                        'BLOCKER', 3),
    ('GLASS',      'Windshield and mirrors',                  'Kioo cha mbele na vioo vya kando',         'WARNING', 4),
    ('FLUIDS',     'Fluid levels (oil and coolant)',          'Viwango vya majimaji (mafuta na kipoza)',  'BLOCKER', 5)
) AS x(code, label_en, label_sw, severity, seq)
WHERE t.code = 'DVIR_TRACTOR_V1' AND t.version = 1
ON CONFLICT (template_id, code) DO NOTHING;

-- Trailer checklist (spec 1.1), including the numeric reefer temperature (M6)
INSERT INTO app.inspection_template_items
    (template_id, code, label_en, label_sw, severity, input_type, unit, min_value, max_value, is_required, sequence)
SELECT t.id, 'TRAILER_LIGHTS', 'Trailer lights (brake and turn)', 'Taa za trela (breki na kugeuza)',
       'BLOCKER', 'PASS_FAIL', NULL, NULL, NULL, true, 1
FROM app.inspection_templates t WHERE t.code = 'DVIR_TRAILER_V1' AND t.version = 1
ON CONFLICT (template_id, code) DO NOTHING;

INSERT INTO app.inspection_template_items
    (template_id, code, label_en, label_sw, severity, input_type, unit, min_value, max_value, is_required, sequence)
SELECT t.id, x.code, x.label_en, x.label_sw, x.severity::app.inspection_severity, 'PASS_FAIL', NULL, NULL, NULL, true, x.seq
FROM app.inspection_templates t
CROSS JOIN (VALUES
    ('AIR_BRAKES',   'Air brakes and gladhand connections', 'Breki za hewa na viunganishi vya hewa', 'BLOCKER', 2),
    ('LANDING_GEAR', 'Landing gear (raised or lowered)',    'Miguu ya kusimamisha trela',            'BLOCKER', 3),
    ('TRAILER_TIRES','Tyres (pressure and tread)',          'Matairi (mgandamizo na nyayo)',         'BLOCKER', 4),
    ('DOORS',        'Rear roller door / side curtains secure', 'Mlango wa nyuma / pazia za kando',  'WARNING', 5)
) AS x(code, label_en, label_sw, severity, seq)
WHERE t.code = 'DVIR_TRAILER_V1' AND t.version = 1
ON CONFLICT (template_id, code) DO NOTHING;

INSERT INTO app.inspection_template_items
    (template_id, code, label_en, label_sw, severity, input_type, unit, min_value, max_value, is_required, sequence)
SELECT t.id, 'REEFER_TEMP', 'Reefer temperature', 'Kipimo cha joto la friji',
       'WARNING', 'NUMERIC', 'C', -40.00, 40.00, false, 6
FROM app.inspection_templates t WHERE t.code = 'DVIR_TRAILER_V1' AND t.version = 1
ON CONFLICT (template_id, code) DO NOTHING;

-- Abbreviated mid-shift hook check (spec 1.3 step 3)
INSERT INTO app.inspection_template_items
    (template_id, code, label_en, label_sw, severity, input_type, sequence)
SELECT t.id, x.code, x.label_en, x.label_sw, 'BLOCKER'::app.inspection_severity, 'PASS_FAIL', x.seq
FROM app.inspection_templates t
CROSS JOIN (VALUES
    ('SWAP_LIGHTS',       'Lights',       'Taa',                        1),
    ('SWAP_LANDING_GEAR', 'Landing gear', 'Miguu ya kusimamisha trela', 2),
    ('SWAP_DOORS',        'Doors secure', 'Milango imefungwa',          3)
) AS x(code, label_en, label_sw, seq)
WHERE t.code = 'SWAP_TRAILER_V1' AND t.version = 1
ON CONFLICT (template_id, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Maintenance tasks  (3.6, C3.11, C3.12)
-- -----------------------------------------------------------------------------
INSERT INTO app.maintenance_tasks
    (code, name, applies_to, trigger_type, interval_km, interval_days, auto_quarantine_enabled)
VALUES
    ('OIL_CHANGE',       'Oil change',            'VEHICLE', 'ODOMETER', 10000, NULL, false),
    ('TYRE_ROTATION',    'Tyre rotation',         'VEHICLE', 'ODOMETER', 10000, NULL, false),
    ('BRAKE_INSPECTION', 'Brake inspection',      'VEHICLE', 'ODOMETER', 20000, NULL, false),
    ('ANNUAL_SERVICE',   'Annual service',        'VEHICLE', 'TIME',     NULL,  365,  false),
    ('TRAILER_ANNUAL',   'Trailer annual service','TRAILER', 'TIME',     NULL,  365,  false)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Notification templates  (7.2, A2.6)
-- -----------------------------------------------------------------------------
INSERT INTO app.notification_templates
    (code, description, default_priority, default_channels, title_en, body_en, title_sw, body_sw, breaks_quiet_hours)
VALUES
    ('HOS_BREAK_WARNING', 'Rest break required soon (3.2)', 'HIGH', '{PUSH}',
     'Rest break required', 'You must take a 30-minute rest break within {{minutes}} minutes.',
     'Mapumziko yanahitajika', 'Lazima uchukue mapumziko ya dakika 30 ndani ya dakika {{minutes}}.', false),
    ('HOS_LIMIT_REACHED', 'Driving limit reached (3.2)', 'CRITICAL', '{PUSH}',
     'HOS limit reached', 'Driving limit reached. Pull over safely and stop driving.',
     'Kikomo cha saa kimefikiwa', 'Umefikia kikomo cha kuendesha. Egesha salama na uache kuendesha.', true),
    ('HOS_LIMIT_ADMIN', 'Driver hit the HOS limit (3.2)', 'HIGH', '{PUSH,EMAIL}',
     'Driver at HOS limit', '{{driver_name}} has reached the driving limit on {{vehicle_plate}}.',
     NULL, NULL, false),
    ('AUTOCLOCKOUT_COUNTDOWN', 'Yard auto-clockout countdown (A1.7)', 'HIGH', '{PUSH}',
     'Auto clock-out in {{minutes}} min', 'You appear parked in the yard. Tap to cancel or clock out now.',
     'Kutoka kazini kiotomatiki baada ya dakika {{minutes}}', 'Unaonekana umeegesha yadi. Gusa kughairi au toka sasa.', false),
    ('SHIFT_OVERRUN', 'Duty period exceeded 14 h (N6)', 'HIGH', '{PUSH,EMAIL}',
     'Shift overrun', 'Shift has exceeded {{hours}} hours of duty and must be closed.',
     'Zamu imepitiliza', 'Zamu imepita saa {{hours}} za kazi na lazima ifungwe.', false),
    ('SHIFT_FLAGGED', 'Shift flagged back to the driver (2.7)', 'NORMAL', '{PUSH}',
     'Shift needs attention', 'Your shift on {{shift_date}} was flagged: {{reason}}.',
     'Zamu inahitaji marekebisho', 'Zamu yako ya {{shift_date}} imewekwa alama: {{reason}}.', false),
    ('ACCIDENT_REPORTED', 'Accident reported (3.1)', 'CRITICAL', '{PUSH,SMS,EMAIL}',
     'ACCIDENT: {{vehicle_plate}}', '{{driver_name}} reported an accident. Acknowledge immediately.',
     NULL, NULL, true),
    ('ACCIDENT_MAYDAY', 'Mayday - driver may be injured (B17)', 'CRITICAL', '{PUSH,SMS,EMAIL}',
     'MAYDAY: {{vehicle_plate}}', '{{driver_name}} pressed SEND HELP NOW. Location attached. Respond immediately.',
     NULL, NULL, true),
    ('ACCIDENT_ESCALATION', 'No acknowledgement within the window (C6.3)', 'CRITICAL', '{SMS,EMAIL}',
     'ESCALATION: unacknowledged accident', 'Accident {{accident_id}} was not acknowledged within {{minutes}} minutes.',
     NULL, NULL, true),
    ('FUEL_ANOMALY_CRITICAL', 'Critical fuel anomaly (2.5)', 'HIGH', '{PUSH,EMAIL}',
     'Fuel anomaly on {{vehicle_plate}}', '{{anomaly_type}} detected: expected {{expected}}, actual {{actual}}.',
     NULL, NULL, false),
    ('DOCUMENT_EXPIRING', 'Document expiring soon (3.5/B8)', 'NORMAL', '{EMAIL}',
     'Document expiring', '{{document_type}} for {{asset}} expires in {{days}} days.',
     NULL, NULL, false),
    ('DOCUMENT_EXPIRED', 'Document expired, asset blocked (3.5)', 'HIGH', '{PUSH,EMAIL}',
     'Document expired', '{{document_type}} for {{asset}} has expired. The asset is now blocked.',
     NULL, NULL, false),
    ('MAINTENANCE_DUE', 'Maintenance due (3.6)', 'NORMAL', '{EMAIL}',
     'Maintenance due', '{{asset}} is due for {{task}} ({{overdue}} overdue).',
     NULL, NULL, false),
    ('OFF_SHIFT_MOVEMENT', 'Unauthorised off-shift movement (C5.6)', 'HIGH', '{PUSH,EMAIL}',
     'Unauthorised movement', '{{vehicle_plate}} moved off-shift at {{time}}. Location was not recorded.',
     NULL, NULL, false),
    ('TRACKER_OFFLINE', 'Tracker stopped reporting (N5)', 'NORMAL', '{EMAIL}',
     'Tracker offline', '{{vehicle_plate}} has not reported a position for {{minutes}} minutes.',
     NULL, NULL, false),
    ('EXPENSE_HIGH_VALUE', 'High-value expense submitted (C2.7)', 'NORMAL', '{EMAIL}',
     'High-value expense', '{{driver_name}} submitted a {{category}} expense of {{amount}}.',
     NULL, NULL, false)
ON CONFLICT (code) DO NOTHING;
