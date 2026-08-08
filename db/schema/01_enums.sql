-- =============================================================================
-- 01_enums.sql
-- Fleet Management Platform - Enumerated types
--
-- Enums are used where the value set is closed and governed by a locked
-- decision. Anything the Admin can configure at runtime (expense categories in
-- Phase 2, document types, checklist items) is a table, not an enum.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- Identity and access (N4, C6.1)
-- -----------------------------------------------------------------------------

-- C6.1 / N4: a user may hold several of these simultaneously.
CREATE TYPE app.role_code AS ENUM (
    'DRIVER',
    'DISPATCHER',
    'FLEET_MANAGER',
    'ADMIN',
    'FINANCE',
    'AUDITOR'
);

CREATE TYPE app.driver_status AS ENUM (
    'PENDING',         -- created by an admin, awaiting approval before the driver can sign in
    'ACTIVE',
    'SUSPENDED',       -- B13: device refresh tokens are revoked on entry
    'ON_LEAVE',
    'TERMINATED'
);

CREATE TYPE app.consent_type AS ENUM (
    'GPS_TRACKING_WORKING_HOURS',   -- C5.5, mandatory before first shift
    'PHONE_GPS_FALLBACK',           -- C1.9, opt-in, revocable
    'DATA_PROCESSING_NOTICE'
);

-- -----------------------------------------------------------------------------
-- Assets (Pillar 4)
-- -----------------------------------------------------------------------------

-- C4.1: the fleet is not exclusively tractor+trailer.
CREATE TYPE app.vehicle_class AS ENUM (
    'TRACTOR',
    'RIGID',
    'VAN',
    'PICKUP'
);

CREATE TYPE app.trailer_type AS ENUM (
    'DRY_VAN',
    'REEFER',
    'FLATBED',
    'LOWBOY',
    'TANKER',
    'CURTAIN_SIDE',
    'OTHER'
);

-- C4.4
CREATE TYPE app.ownership_type AS ENUM (
    'OWNED',
    'LEASED',
    'SUBCONTRACTOR'
);

-- C1.11: EXTERNAL is a driver-created placeholder awaiting Admin merge.
CREATE TYPE app.asset_status AS ENUM (
    'AVAILABLE',
    'IN_USE',
    'UNDER_MAINTENANCE',
    'QUARANTINED',
    'EXTERNAL',
    'RETIRED'
);

-- Origin of a quarantine. Drives C3.9: only ACCIDENT requires a repair PDF to lift.
CREATE TYPE app.quarantine_reason AS ENUM (
    'ACCIDENT',
    'FAILED_INSPECTION',
    'MAINTENANCE_OVERDUE',
    'DOCUMENT_EXPIRED',
    'MANUAL'
);

-- C3.10: generic document registry across vehicles, trailers and drivers.
CREATE TYPE app.document_type AS ENUM (
    'INSURANCE',
    'ROAD_TAX',
    'FITNESS_CERTIFICATE',
    'SPEED_GOVERNOR_CERTIFICATE',
    'DRIVING_LICENCE',
    'MEDICAL_CERTIFICATE',
    'PSV_BADGE',
    'REPAIR_COMPLETION',
    'OTHER'
);

CREATE TYPE app.geofence_kind AS ENUM (
    'YARD',            -- eligible for auto-clockout (A1.7)
    'CUSTOMER_SITE',
    'RESTRICTED_ZONE'
);

-- -----------------------------------------------------------------------------
-- Operations (Pillar 1)
-- -----------------------------------------------------------------------------

-- B7 / N6: PENDING_CLOSEOUT means the shift ended without its mandatory final
-- evidence. The driver is blocked from a new shift until it is supplied.
CREATE TYPE app.shift_state AS ENUM (
    'OPEN',
    'PENDING_CLOSEOUT',
    'CLOSED'
);

CREATE TYPE app.shift_verification_status AS ENUM (
    'PENDING',
    'VERIFIED',
    'FLAGGED'
);

-- A1.7 / N6: AUTO_GEOFENCE is the only non-human clock-out path.
CREATE TYPE app.shift_event_source AS ENUM (
    'DRIVER',
    'ADMIN_OVERRIDE',
    'AUTO_GEOFENCE',
    'SYSTEM_VEHICLE_SWAP'
);

-- C1.9: how much of the driving time is trustworthy.
CREATE TYPE app.tracker_reliability AS ENUM (
    'FULL',      -- no gap exceeded the interpolation threshold
    'PARTIAL',   -- one or more gaps > 5 min were excluded
    'NONE'       -- no telemetry at all; driving time is unknown
);

CREATE TYPE app.distance_source AS ENUM (
    'ODOMETER',       -- C4.2 authoritative
    'GPS_AGGREGATE',  -- fallback when an odometer reading is missing
    'UNAVAILABLE'
);

CREATE TYPE app.inspection_subject AS ENUM (
    'VEHICLE',
    'TRAILER',
    'TRAILER_SWAP'    -- the abbreviated 3-item mid-shift check (spec 1.3 step 3)
);

CREATE TYPE app.inspection_item_result AS ENUM (
    'PASS',
    'FAIL',
    'NOT_APPLICABLE'
);

-- C1.5: per-item severity decides whether a failure blocks the shift.
CREATE TYPE app.inspection_severity AS ENUM (
    'BLOCKER',
    'WARNING'
);

CREATE TYPE app.inspection_input_type AS ENUM (
    'PASS_FAIL',
    'NUMERIC'         -- e.g. reefer temperature (M6)
);

CREATE TYPE app.assignment_status AS ENUM (
    'PLANNED',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED'
);

-- -----------------------------------------------------------------------------
-- Telemetry and HOS (Pillar 3 / N7)
-- -----------------------------------------------------------------------------

-- N5: locked marker legend. Precedence is applied in app.v_vehicle_display_state.
CREATE TYPE app.vehicle_display_state AS ENUM (
    'QUARANTINED',    -- red    (highest precedence)
    'OFFLINE',        -- grey   no position for > tracker.offline_threshold_minutes
    'HOS_ALERT',      -- orange driver at or approaching the HOS limit
    'SPEEDING',       -- yellow over speed.limit_kph
    'MOVING',         -- green  ignition ON, speed > 3 km/h
    'IDLING',         -- blue   ignition ON, speed <= 3 km/h
    'PARKED'          -- slate  ignition OFF, tracker online
);

-- N7 / N8: the driver-centric duty ledger that replaces per-shift HOS.
CREATE TYPE app.duty_status AS ENUM (
    'OFF_DUTY',
    'ON_DUTY_NOT_DRIVING',
    'DRIVING',
    'BREAK'
);

CREATE TYPE app.duty_segment_source AS ENUM (
    'TELEMETRY_INFERRED',   -- N8: derived from ignition/speed
    'DRIVER_DECLARED',
    'ADMIN_CORRECTED',
    'SYSTEM'
);

CREATE TYPE app.hos_violation_type AS ENUM (
    'DAILY_DRIVING_LIMIT',
    'CONTINUOUS_DRIVING_WITHOUT_BREAK',
    'DAILY_REST_INSUFFICIENT',
    'WEEKLY_REST_INSUFFICIENT',
    'DUTY_PERIOD_EXCEEDED'
);

-- -----------------------------------------------------------------------------
-- Financial (Pillar 2)
-- -----------------------------------------------------------------------------

-- B2: driver-selected gauge positions. No OCR of analogue needles.
CREATE TYPE app.fuel_gauge_level AS ENUM (
    'EMPTY',
    'QUARTER',
    'HALF',
    'THREE_QUARTER',
    'FULL'
);

-- B1, B3: every reason a dashboard/gauge photo is captured.
CREATE TYPE app.fuel_record_purpose AS ENUM (
    'SHIFT_START',      -- B1 mandatory at clock-in
    'SHIFT_END',        -- mandatory at clock-out
    'REFUEL_BEFORE',    -- B3 mandatory before pumping
    'REFUEL_AFTER',     -- B3 mandatory after pumping
    'SPOT_CHECK'        -- driver-initiated Fuel Gauge quick action
);

CREATE TYPE app.ocr_status AS ENUM (
    'PENDING',
    'SUCCEEDED_VISION',
    'SUCCEEDED_TESSERACT',
    'FAILED',
    'SKIPPED'
);

-- B5: which method produced the consumption figure.
CREATE TYPE app.consumption_method AS ENUM (
    'FULL_TO_FULL',      -- authoritative
    'GAUGE_ESTIMATE'     -- approximate; flagged in reports
);

CREATE TYPE app.fuel_anomaly_type AS ENUM (
    'POSSIBLE_THEFT_OR_LEAK',   -- 2.5 gauge rise vs litres purchased
    'CARD_MISMATCH',            -- M2, non-pooled card on the wrong vehicle
    'EXPIRED_CARD',             -- C2.3 accepted and flagged, never blocked
    'EFFICIENCY_DEVIATION',     -- 2.6 vs the rolling baseline (B6)
    'ODOMETER_ROLLBACK',        -- C4.2
    'ODOMETER_DIVERGENCE',      -- M3 driver photo vs OBD/tracker
    'GAUGE_OBD_DIVERGENCE',     -- M3 advisory only
    'DUPLICATE_PURCHASE',
    'PRICE_OUTLIER',
    'MISSING_GAUGE_EVIDENCE'    -- B3 photos absent, engine could not evaluate
);

CREATE TYPE app.anomaly_severity AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
);

-- C2.7: fixed in Phase 1. Becomes a table in Phase 2.
CREATE TYPE app.expense_category AS ENUM (
    'TOLL',
    'PARKING',
    'REPAIR',
    'OTHER'
);

CREATE TYPE app.approval_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);

-- A1.9: outcome of matching a statement line to a receipt.
CREATE TYPE app.reconciliation_match_status AS ENUM (
    'UNMATCHED',
    'MATCHED',
    'AMBIGUOUS',
    'MANUALLY_MATCHED',
    'DISPUTED'
);

-- -----------------------------------------------------------------------------
-- Safety (Pillar 3)
-- -----------------------------------------------------------------------------

CREATE TYPE app.accident_status AS ENUM (
    'PENDING',
    'INVESTIGATING',
    'RESOLVED',
    'CLOSED'
);

-- B17: the four mandatory slots, plus the escape hatches and admin uploads.
CREATE TYPE app.accident_media_slot AS ENUM (
    'FRONT_DAMAGE',
    'REAR_DAMAGE',
    'SIDE_DAMAGE',
    'OTHER_VEHICLE_PLATE',
    'WITNESS',
    'ADDITIONAL',
    'POLICE_ABSTRACT',
    'INSURANCE_DOCUMENT'
);

CREATE TYPE app.statement_source AS ENUM (
    'TYPED',
    'VOICE_TO_TEXT',
    'NOT_PROVIDED'      -- B17 mayday path
);

CREATE TYPE app.maintenance_trigger_type AS ENUM (
    'ODOMETER',
    'TIME',
    'ENGINE_HOURS'
);

CREATE TYPE app.maintenance_schedule_status AS ENUM (
    'OK',
    'DUE_SOON',
    'OVERDUE'
);

-- -----------------------------------------------------------------------------
-- Platform (notifications, media, audit)
-- -----------------------------------------------------------------------------

CREATE TYPE app.notification_channel AS ENUM (
    'PUSH',      -- N9: FCM direct
    'SMS',       -- A1.8: Africa's Talking
    'EMAIL',
    'IN_APP'
);

CREATE TYPE app.notification_priority AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'CRITICAL'   -- C6.4: breaks through quiet hours
);

CREATE TYPE app.notification_status AS ENUM (
    'QUEUED',
    'SENT',
    'DELIVERED',      -- N9: requires a provider delivery receipt
    'FAILED',
    'SUPPRESSED_DND'  -- C6.4
);

-- C5.3 / D5: drives lifecycle rules and S3 Object Lock placement.
CREATE TYPE app.retention_class AS ENUM (
    'WORK_PLAN',        -- 7 years (M7)
    'INSPECTION',       -- 7 years (M7)
    'FUEL_RECEIPT',     -- 7 years
    'FUEL_DASHBOARD',   -- 7 years
    'EXPENSE_RECEIPT',  -- 7 years
    'ACCIDENT',         -- 7 years, Object Lock, immutable
    'ASSET_DOCUMENT',   -- 7 years
    'MAINTENANCE',      -- 7 years
    'STATEMENT_IMPORT', -- 7 years
    'TRAILER_SWAP'      -- 7 years
);

CREATE TYPE app.media_owner_kind AS ENUM (
    'WORK_LOG',
    'INSPECTION_ITEM',
    'FUEL_RECORD',
    'FUEL_PURCHASE',
    'EXPENSE',
    'ACCIDENT_REPORT',
    'ASSET_DOCUMENT',
    'TRAILER_ASSIGNMENT',
    'MAINTENANCE_RECORD',
    'QUARANTINE_EVENT',
    'STATEMENT_IMPORT'
);

CREATE TYPE app.audit_action AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGIN_FAILED',
    'LOGOUT',
    'OVERRIDE',
    'VERIFY',
    'FLAG',
    'UNLOCK_FOR_CORRECTION',
    'QUARANTINE',
    'LIFT_QUARANTINE',
    'EXPORT',
    'CONFIG_CHANGE',
    'DEVICE_REVOKE',
    'RECOVERY_MODE_ENABLE',
    'RECOVERY_MODE_DISABLE'
);
