-- =============================================================================
-- 05_operations.sql
-- Fleet Management Platform - Shifts, work logs, DVIR, trailer hook/drop
--
-- Decisions: B1, B7, B18, C1.1-C1.14, C4.2, N6, N7, M6
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.shifts
-- -----------------------------------------------------------------------------
-- One row per continuous duty period on one vehicle. A mid-day vehicle swap
-- (C1.7) closes this shift and opens a successor linked by previous_shift_id;
-- HOS is unaffected because HOS is driver-centric (N7).
--
-- N6: the 14-hour rule does NOT auto-close. It sets is_overrun and alerts.
-- Automatic closure is reserved for the A1.7 yard condition.
-- -----------------------------------------------------------------------------
CREATE TABLE app.shifts (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    driver_id                   uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,
    vehicle_id                  uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    assigned_trailer_id         uuid REFERENCES app.trailers(id) ON DELETE SET NULL,
    assignment_id               uuid REFERENCES app.assignments(id) ON DELETE SET NULL,

    clock_in_at                 timestamptz NOT NULL,
    clock_in_source             app.shift_event_source NOT NULL DEFAULT 'DRIVER',
    clock_out_at                timestamptz,
    clock_out_source            app.shift_event_source,
    clock_out_by                uuid REFERENCES app.users(id),

    -- Operational date in EAT, generated so dispatch and reports never disagree (A2.3).
    operational_date            date GENERATED ALWAYS AS
                                (((clock_in_at AT TIME ZONE 'Africa/Nairobi')::date)) STORED,

    -- B1: both are captured from a photographed dashboard reading (C4.2).
    start_odometer_km           app.odometer_km NOT NULL,
    end_odometer_km             app.odometer_km,
    start_fuel_gauge            app.fuel_gauge_level,
    end_fuel_gauge              app.fuel_gauge_level,

    shift_duration_seconds      integer CHECK (shift_duration_seconds IS NULL OR shift_duration_seconds >= 0),
    driving_duration_seconds    integer CHECK (driving_duration_seconds IS NULL OR driving_duration_seconds >= 0),
    idle_duration_seconds       integer CHECK (idle_duration_seconds IS NULL OR idle_duration_seconds >= 0),

    total_distance_km           numeric(10,2) CHECK (total_distance_km IS NULL OR total_distance_km >= 0),
    distance_source             app.distance_source NOT NULL DEFAULT 'UNAVAILABLE',

    -- C1.9: how trustworthy the computed driving time is.
    tracker_reliability         app.tracker_reliability NOT NULL DEFAULT 'FULL',
    excluded_gap_seconds        integer NOT NULL DEFAULT 0 CHECK (excluded_gap_seconds >= 0),
    -- C1.10: clock-in was allowed despite a dead tracker.
    started_with_tracker_offline boolean NOT NULL DEFAULT false,
    phone_gps_fallback_enabled  boolean NOT NULL DEFAULT false,

    state                       app.shift_state NOT NULL DEFAULT 'OPEN',
    -- B7: which mandatory close-out artefacts are still missing, e.g.
    -- ["END_ODOMETER_PHOTO"]. The driver cannot open a new shift until empty.
    closeout_missing            jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- N6
    is_overrun                  boolean NOT NULL DEFAULT false,
    overrun_warned_at           timestamptz,
    overrun_at                  timestamptz,

    verification_status         app.shift_verification_status NOT NULL DEFAULT 'PENDING',
    verified_by                 uuid REFERENCES app.users(id),
    verified_at                 timestamptz,
    flag_reason                 text,

    -- B18: verified shifts are locked, not immutable. Unlocking is audited.
    locked_at                   timestamptz,
    unlocked_at                 timestamptz,
    unlocked_by                 uuid REFERENCES app.users(id),
    unlock_reason               text,
    unlock_count                smallint NOT NULL DEFAULT 0 CHECK (unlock_count >= 0),
    corrected_at                timestamptz,
    corrected_by                uuid REFERENCES app.users(id),
    correction_reason           text,

    -- C1.7: back-to-back continuity across a vehicle swap.
    previous_shift_id           uuid REFERENCES app.shifts(id) ON DELETE SET NULL,

    client_uuid                 uuid,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT shifts_clock_order
        CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
    CONSTRAINT shifts_open_has_no_clock_out
        CHECK ((state = 'OPEN') = (clock_out_at IS NULL)),
    CONSTRAINT shifts_clock_out_source_present
        CHECK ((clock_out_at IS NULL) = (clock_out_source IS NULL)),
    -- C4.2: the odometer can never run backwards within a shift.
    CONSTRAINT shifts_odometer_not_decreasing
        CHECK (end_odometer_km IS NULL OR end_odometer_km >= start_odometer_km),
    CONSTRAINT shifts_verified_is_locked
        CHECK (verification_status <> 'VERIFIED'
               OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND locked_at IS NOT NULL)),
    CONSTRAINT shifts_flagged_has_reason
        CHECK (verification_status <> 'FLAGGED' OR flag_reason IS NOT NULL),
    CONSTRAINT shifts_unlock_complete
        CHECK (unlocked_at IS NULL OR (unlocked_by IS NOT NULL AND unlock_reason IS NOT NULL)),
    CONSTRAINT shifts_correction_complete
        CHECK (corrected_at IS NULL OR (corrected_by IS NOT NULL AND correction_reason IS NOT NULL)),
    CONSTRAINT shifts_no_self_predecessor
        CHECK (previous_shift_id IS DISTINCT FROM id),
    CONSTRAINT shifts_pending_closeout_has_gaps
        CHECK (state <> 'PENDING_CLOSEOUT' OR jsonb_array_length(closeout_missing) > 0)
);

-- Only one open shift per driver and per vehicle at any moment (spec 1.1).
CREATE UNIQUE INDEX shifts_one_open_per_driver
    ON app.shifts (driver_id) WHERE clock_out_at IS NULL;
CREATE UNIQUE INDEX shifts_one_open_per_vehicle
    ON app.shifts (vehicle_id) WHERE clock_out_at IS NULL;

CREATE INDEX shifts_driver_date_idx        ON app.shifts (driver_id, operational_date DESC);
CREATE INDEX shifts_vehicle_date_idx       ON app.shifts (vehicle_id, operational_date DESC);
CREATE INDEX shifts_verification_inbox_idx ON app.shifts (verification_status, clock_out_at DESC)
                                              WHERE state = 'CLOSED';
CREATE INDEX shifts_open_idx               ON app.shifts (clock_in_at) WHERE state = 'OPEN';
CREATE INDEX shifts_pending_closeout_idx   ON app.shifts (driver_id) WHERE state = 'PENDING_CLOSEOUT';
CREATE INDEX shifts_trailer_idx            ON app.shifts (assigned_trailer_id)
                                              WHERE assigned_trailer_id IS NOT NULL;

COMMENT ON COLUMN app.shifts.closeout_missing IS
    'B7. Non-empty means the driver is blocked from starting a new shift until the evidence is supplied.';
COMMENT ON COLUMN app.shifts.is_overrun IS
    'N6. Set at 14 h of duty. Alerts only - it never auto-closes the shift.';

-- -----------------------------------------------------------------------------
-- Guard: B7 - a driver with an unresolved close-out cannot open a new shift.
-- Also guards C3.3 at the database level as a defence in depth; the primary
-- HOS rest check lives in the clock-in service against driver_hos_state.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_shifts_block_when_pending_closeout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_blocking_shift uuid;
BEGIN
    SELECT s.id INTO v_blocking_shift
      FROM app.shifts s
     WHERE s.driver_id = NEW.driver_id
       AND s.state = 'PENDING_CLOSEOUT'
       AND s.id <> NEW.id
     LIMIT 1;

    IF v_blocking_shift IS NOT NULL THEN
        RAISE EXCEPTION
            'Driver % has shift % awaiting close-out evidence (B7).',
            NEW.driver_id, v_blocking_shift
            USING ERRCODE = 'restrict_violation',
                  HINT = 'Submit the outstanding end-of-shift odometer photo first.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER shifts_block_when_pending_closeout
    BEFORE INSERT ON app.shifts
    FOR EACH ROW EXECUTE FUNCTION app.fn_shifts_block_when_pending_closeout();

-- -----------------------------------------------------------------------------
-- Guard: C4.2 - the start odometer may not be lower than the vehicle's last
-- recorded reading. Rejected outright rather than flagged, per the locked answer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_shifts_validate_start_odometer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_current app.odometer_km;
BEGIN
    SELECT current_odometer_km INTO v_current
      FROM app.vehicles WHERE id = NEW.vehicle_id;

    IF v_current IS NOT NULL AND NEW.start_odometer_km < v_current THEN
        RAISE EXCEPTION
            'Odometer cannot decrease: entered % km, vehicle last recorded % km (C4.2).',
            NEW.start_odometer_km, v_current
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER shifts_validate_start_odometer
    BEFORE INSERT ON app.shifts
    FOR EACH ROW EXECUTE FUNCTION app.fn_shifts_validate_start_odometer();

CREATE TRIGGER shifts_set_updated_at
    BEFORE UPDATE ON app.shifts
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER shifts_no_hard_delete
    BEFORE DELETE ON app.shifts
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

-- -----------------------------------------------------------------------------
-- app.work_logs / app.work_log_photos  (1.1, C1.13)
-- -----------------------------------------------------------------------------
CREATE TABLE app.work_logs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id        uuid NOT NULL UNIQUE REFERENCES app.shifts(id) ON DELETE CASCADE,
    planned_notes   text,
    debrief_notes   text,          -- 1.4 optional end-of-shift debrief
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.work_log_photos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_log_id     uuid NOT NULL REFERENCES app.work_logs(id) ON DELETE CASCADE,
    media_object_id uuid NOT NULL REFERENCES app.media_objects(id),
    sequence        smallint NOT NULL CHECK (sequence BETWEEN 1 AND 5),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (work_log_id, sequence),
    UNIQUE (media_object_id)
);

CREATE INDEX work_log_photos_log_idx ON app.work_log_photos (work_log_id);

-- 1.1 validation: "Start Shift" requires EITHER a work-plan photo OR text.
-- Deferred to commit so the multipart clock-in transaction can insert the log
-- row and its photos in any order.
CREATE OR REPLACE FUNCTION app.fn_work_logs_require_plan_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_photo_count integer;
    v_log         app.work_logs%ROWTYPE;
BEGIN
    SELECT * INTO v_log FROM app.work_logs WHERE id = NEW.id;
    IF NOT FOUND THEN
        RETURN NULL;   -- row was rolled back or deleted; nothing to validate
    END IF;

    SELECT count(*) INTO v_photo_count
      FROM app.work_log_photos WHERE work_log_id = v_log.id;

    IF v_photo_count = 0 AND coalesce(btrim(v_log.planned_notes), '') = '' THEN
        RAISE EXCEPTION
            'Work plan requires at least one photo or non-empty planned_notes (spec 1.1).'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER work_logs_require_plan_evidence
    AFTER INSERT OR UPDATE ON app.work_logs
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_work_logs_require_plan_evidence();

CREATE TRIGGER work_logs_set_updated_at
    BEFORE UPDATE ON app.work_logs
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- app.inspection_templates / app.inspection_template_items  (C1.4, C1.5, A2.6)
-- -----------------------------------------------------------------------------
-- Templates are versioned and immutable once published: an edit creates a new
-- version. Historic inspections therefore always resolve to the exact checklist
-- the driver actually saw, which is what makes a DVIR defensible.
-- -----------------------------------------------------------------------------
CREATE TABLE app.inspection_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL,
    name            text NOT NULL,
    subject         app.inspection_subject NOT NULL,
    vehicle_class   app.vehicle_class,     -- NULL = applies to all vehicle classes
    trailer_type    app.trailer_type,      -- NULL = applies to all trailer types
    version         integer NOT NULL CHECK (version >= 1),
    is_active       boolean NOT NULL DEFAULT true,
    published_at    timestamptz,
    created_by      uuid REFERENCES app.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inspection_templates_scope_matches_subject CHECK (
        (subject = 'VEHICLE' AND trailer_type IS NULL)
     OR (subject IN ('TRAILER','TRAILER_SWAP') AND vehicle_class IS NULL)
    )
);

CREATE UNIQUE INDEX inspection_templates_code_version_unique
    ON app.inspection_templates (code, version);
-- Only one active version per code at a time.
CREATE UNIQUE INDEX inspection_templates_one_active_per_code
    ON app.inspection_templates (code) WHERE is_active = true;

CREATE TABLE app.inspection_template_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid NOT NULL REFERENCES app.inspection_templates(id) ON DELETE CASCADE,
    code            text NOT NULL,
    label_en        text NOT NULL,
    label_sw        text NOT NULL,          -- A2.6 bilingual driver app
    -- C1.5: BLOCKER failures stop the shift and quarantine the asset.
    severity        app.inspection_severity NOT NULL,
    input_type      app.inspection_input_type NOT NULL DEFAULT 'PASS_FAIL',
    unit            text,                   -- e.g. 'C' for reefer temperature (M6)
    min_value       numeric(7,2),
    max_value       numeric(7,2),
    is_required     boolean NOT NULL DEFAULT true,
    sequence        smallint NOT NULL,

    UNIQUE (template_id, code),
    UNIQUE (template_id, sequence),
    CONSTRAINT template_items_numeric_has_bounds
        CHECK (input_type <> 'NUMERIC' OR (min_value IS NOT NULL AND max_value IS NOT NULL AND min_value <= max_value)),
    CONSTRAINT template_items_passfail_has_no_bounds
        CHECK (input_type <> 'PASS_FAIL' OR (min_value IS NULL AND max_value IS NULL AND unit IS NULL))
);

-- -----------------------------------------------------------------------------
-- app.inspections / app.inspection_items / app.inspection_item_photos
-- (1.1, 1.3, C1.5, C1.6)
-- -----------------------------------------------------------------------------
CREATE TABLE app.inspections (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                    uuid NOT NULL REFERENCES app.shifts(id) ON DELETE CASCADE,
    template_id                 uuid NOT NULL REFERENCES app.inspection_templates(id),
    template_version            integer NOT NULL,
    subject                     app.inspection_subject NOT NULL,

    vehicle_id                  uuid REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    trailer_id                  uuid REFERENCES app.trailers(id) ON DELETE RESTRICT,

    performed_by_driver_id      uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,
    performed_at                timestamptz NOT NULL DEFAULT now(),

    has_blocking_failure        boolean NOT NULL DEFAULT false,
    has_warning_failure         boolean NOT NULL DEFAULT false,

    -- C1.6: legal DVIR acknowledgement plus typed signature.
    previous_defects_reviewed   boolean NOT NULL,
    signature_name              text NOT NULL CHECK (btrim(signature_name) <> ''),
    signed_at                   timestamptz NOT NULL DEFAULT now(),

    client_uuid                 uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT inspections_subject_target CHECK (
        (subject = 'VEHICLE'  AND vehicle_id IS NOT NULL AND trailer_id IS NULL)
     OR (subject IN ('TRAILER','TRAILER_SWAP') AND trailer_id IS NOT NULL)
    ),
    CONSTRAINT inspections_defects_must_be_reviewed
        CHECK (previous_defects_reviewed = true)
);

CREATE INDEX inspections_shift_idx    ON app.inspections (shift_id);
CREATE INDEX inspections_vehicle_idx  ON app.inspections (vehicle_id, performed_at DESC);
CREATE INDEX inspections_trailer_idx  ON app.inspections (trailer_id, performed_at DESC);
CREATE INDEX inspections_failures_idx ON app.inspections (performed_at DESC)
                                         WHERE has_blocking_failure = true OR has_warning_failure = true;

COMMENT ON CONSTRAINT inspections_defects_must_be_reviewed ON app.inspections IS
    'C1.6. The driver must affirmatively acknowledge the previous report; an unticked box cannot be persisted.';

CREATE TABLE app.inspection_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id       uuid NOT NULL REFERENCES app.inspections(id) ON DELETE CASCADE,
    template_item_id    uuid NOT NULL REFERENCES app.inspection_template_items(id),

    -- Snapshot of the template at the moment of inspection. The template can be
    -- superseded later; the historic record must remain readable on its own.
    item_code           text NOT NULL,
    label_snapshot      text NOT NULL,
    severity_snapshot   app.inspection_severity NOT NULL,

    result              app.inspection_item_result NOT NULL,
    numeric_value       numeric(7,2),          -- M6: reefer temperature in Celsius
    notes               text,

    UNIQUE (inspection_id, template_item_id),

    -- 1.1/1.2: a failure forces a photo and a description. The photo is enforced
    -- by the deferred constraint trigger below; the text is enforced here.
    CONSTRAINT inspection_items_fail_requires_notes
        CHECK (result <> 'FAIL' OR coalesce(btrim(notes), '') <> '')
);

CREATE INDEX inspection_items_inspection_idx ON app.inspection_items (inspection_id);
CREATE INDEX inspection_items_failures_idx
    ON app.inspection_items (inspection_id) WHERE result = 'FAIL';

CREATE TABLE app.inspection_item_photos (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_item_id  uuid NOT NULL REFERENCES app.inspection_items(id) ON DELETE CASCADE,
    media_object_id     uuid NOT NULL UNIQUE REFERENCES app.media_objects(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inspection_item_photos_item_idx ON app.inspection_item_photos (inspection_item_id);

-- 1.1: "If they tap Fail, the app forces a photo." Enforced at commit so the
-- item and its photo can be inserted in a single transaction in either order.
CREATE OR REPLACE FUNCTION app.fn_inspection_items_fail_requires_photo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_item        app.inspection_items%ROWTYPE;
    v_photo_count integer;
BEGIN
    SELECT * INTO v_item FROM app.inspection_items WHERE id = NEW.id;
    IF NOT FOUND OR v_item.result <> 'FAIL' THEN
        RETURN NULL;
    END IF;

    SELECT count(*) INTO v_photo_count
      FROM app.inspection_item_photos WHERE inspection_item_id = v_item.id;

    IF v_photo_count = 0 THEN
        RAISE EXCEPTION
            'Inspection item % failed and requires at least one photo (spec 1.1).', v_item.item_code
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER inspection_items_fail_requires_photo
    AFTER INSERT OR UPDATE ON app.inspection_items
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION app.fn_inspection_items_fail_requires_photo();

-- -----------------------------------------------------------------------------
-- app.trailer_assignments  (1.3, 4.3, C1.12)
-- -----------------------------------------------------------------------------
-- Every hook and drop. Defined here rather than with the assets because it
-- references shifts. A drop to bobtail (C1.12) simply closes the active row
-- without opening a successor.
-- -----------------------------------------------------------------------------
CREATE TABLE app.trailer_assignments (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trailer_id                  uuid NOT NULL REFERENCES app.trailers(id) ON DELETE RESTRICT,
    vehicle_id                  uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    shift_id                    uuid REFERENCES app.shifts(id) ON DELETE SET NULL,

    assigned_at                 timestamptz NOT NULL DEFAULT now(),
    assigned_by_driver_id       uuid REFERENCES app.drivers(id),
    -- 1.3 step 2: photo of the new trailer's licence plate.
    hook_media_object_id        uuid REFERENCES app.media_objects(id),
    -- 1.3 step 3: the abbreviated three-item check.
    hook_inspection_id          uuid REFERENCES app.inspections(id),

    unassigned_at               timestamptz,
    unassigned_by_driver_id     uuid REFERENCES app.drivers(id),
    -- 1.3 step 1: photo of the dropped trailer, for damage comparison.
    drop_media_object_id        uuid REFERENCES app.media_objects(id),
    drop_location               geography(Point, 4326),

    is_active                   boolean GENERATED ALWAYS AS (unassigned_at IS NULL) STORED,
    created_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT trailer_assignments_time_order
        CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

-- A trailer can be on only one tractor, and a tractor can pull only one trailer.
CREATE UNIQUE INDEX trailer_assignments_one_active_per_trailer
    ON app.trailer_assignments (trailer_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX trailer_assignments_one_active_per_vehicle
    ON app.trailer_assignments (vehicle_id) WHERE unassigned_at IS NULL;
CREATE INDEX trailer_assignments_shift_idx   ON app.trailer_assignments (shift_id);
CREATE INDEX trailer_assignments_history_idx ON app.trailer_assignments (trailer_id, assigned_at DESC);

COMMENT ON TABLE app.trailer_assignments IS
    'Hook/drop ledger (4.3). The unique partial indexes make an impossible double-hook a database error, not a bug.';

-- -----------------------------------------------------------------------------
-- app.trailer_last_known_location  (4.5)
-- -----------------------------------------------------------------------------
-- Trailers without GPS inherit the position of the tractor pulling them. Updated
-- by the telemetry consumer on every retained position; subject to the same
-- off-shift discard rule (C5.6/N3), so the timestamp can legitimately be stale.
-- -----------------------------------------------------------------------------
CREATE TABLE app.trailer_last_known_location (
    trailer_id          uuid PRIMARY KEY REFERENCES app.trailers(id) ON DELETE CASCADE,
    via_vehicle_id      uuid REFERENCES app.vehicles(id) ON DELETE SET NULL,
    position            geography(Point, 4326) NOT NULL,
    recorded_at         timestamptz NOT NULL,
    -- C4.3: Google Geocoding result, cached to control per-call cost.
    address_cached      text,
    address_cached_at   timestamptz,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trailer_last_known_location_gist ON app.trailer_last_known_location USING gist (position);
CREATE INDEX trailer_last_known_location_recorded_idx ON app.trailer_last_known_location (recorded_at DESC);
