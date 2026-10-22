-- =============================================================================
-- 14_vehicle_issues.sql
-- Fleet Management Platform - Driver-reported vehicle issues (defect reports)
--
-- Purpose: the driver-facing "report vehicle issue" flow (spec
-- `report_vehicle_issue`). This is deliberately NOT an accident report: it is a
-- non-incident mechanical/electrical/body defect the driver notices during a
-- shift and wants triaged by maintenance. `app.accident_reports` stays reserved
-- for collisions and the B17 MAYDAY escape hatch, so the two surfaces never
-- share an escalation timer, a retention class or a status vocabulary.
--
-- A reported issue is the inbox item that a FLEET_MANAGER later converts into a
-- maintenance work order (app.maintenance_records) or dismisses.
--
-- Referenced decisions: D3 (soft delete), D8 (audit + outbox in the write tx),
-- N10 (all phases modelled now, additive migrations only).
-- Phase: 3
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.vehicle_issue_category
-- -----------------------------------------------------------------------------
-- Closed set mirroring the driver-app category picker. OTHER is the catch-all so
-- the driver is never blocked by a missing category.
-- -----------------------------------------------------------------------------
CREATE TYPE app.vehicle_issue_category AS ENUM (
    'MECHANICAL',
    'ELECTRICAL',
    'TYRE',
    'BODY',
    'OTHER'
);

-- -----------------------------------------------------------------------------
-- app.vehicle_issue_severity
-- -----------------------------------------------------------------------------
-- Driver-declared urgency. HIGH is the "ground the vehicle" signal reviewed by a
-- FLEET_MANAGER; it does not itself quarantine the asset (that stays an explicit,
-- audited action via app.quarantine_events).
-- -----------------------------------------------------------------------------
CREATE TYPE app.vehicle_issue_severity AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
);

-- -----------------------------------------------------------------------------
-- app.vehicle_issue_status
-- -----------------------------------------------------------------------------
-- Triage lifecycle. OPEN on creation; ACKNOWLEDGED once a manager has seen it;
-- RESOLVED when the defect is fixed; DISMISSED when it is a non-issue.
-- -----------------------------------------------------------------------------
CREATE TYPE app.vehicle_issue_status AS ENUM (
    'OPEN',
    'ACKNOWLEDGED',
    'RESOLVED',
    'DISMISSED'
);

-- -----------------------------------------------------------------------------
-- app.vehicle_issues
-- -----------------------------------------------------------------------------
-- One row per driver-reported defect. shift_id is nullable because a driver may
-- notice a defect off-shift (e.g. during a yard walkaround before clock-in), and
-- photo_media_object_id is nullable because a photo is encouraged but never
-- mandatory — an unphotographed brake fault must still be reportable (contrast
-- with DVIR FAIL items, which do require evidence).
-- -----------------------------------------------------------------------------
CREATE TABLE app.vehicle_issues (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id               uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    reported_by_driver_id    uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,
    shift_id                 uuid REFERENCES app.shifts(id) ON DELETE SET NULL,

    category                 app.vehicle_issue_category NOT NULL,
    severity                 app.vehicle_issue_severity NOT NULL DEFAULT 'LOW',
    description              text NOT NULL,

    photo_media_object_id    uuid REFERENCES app.media_objects(id) ON DELETE SET NULL,

    status                   app.vehicle_issue_status NOT NULL DEFAULT 'OPEN',
    acknowledged_by          uuid REFERENCES app.users(id) ON DELETE SET NULL,
    acknowledged_at          timestamptz,
    resolved_at              timestamptz,
    resolution_note          text,

    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    deleted_at               timestamptz,

    CONSTRAINT vehicle_issues_description_not_blank
        CHECK (length(btrim(description)) > 0)
);

-- Maintenance triage inbox: open issues per asset, newest first.
CREATE INDEX vehicle_issues_vehicle_idx
    ON app.vehicle_issues (vehicle_id, created_at DESC) WHERE deleted_at IS NULL;

-- "My reports" on the driver app.
CREATE INDEX vehicle_issues_driver_idx
    ON app.vehicle_issues (reported_by_driver_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX vehicle_issues_status_idx
    ON app.vehicle_issues (status) WHERE deleted_at IS NULL;

COMMENT ON TABLE app.vehicle_issues IS
    'Driver-reported vehicle defects (non-accident). Feeds the maintenance triage inbox.';
COMMENT ON COLUMN app.vehicle_issues.photo_media_object_id IS
    'Optional single evidence photo. Unlike DVIR FAIL items, evidence is not mandatory here.';
COMMENT ON COLUMN app.vehicle_issues.severity IS
    'Driver-declared urgency. HIGH flags the asset for manager review; it does not auto-quarantine.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER vehicle_issues_set_updated_at
    BEFORE UPDATE ON app.vehicle_issues
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

CREATE TRIGGER vehicle_issues_no_hard_delete
    BEFORE DELETE ON app.vehicle_issues
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();
