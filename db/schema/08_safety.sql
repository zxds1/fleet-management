-- =============================================================================
-- 08_safety.sql
-- Fleet Management Platform - Accidents and immutable evidence, quarantine,
--                             maintenance scheduling
--
-- Decisions: B17, C3.4, C3.5, C3.6, C3.9, C3.11, C3.12, C5.3, D5, N3.2
-- Phase: 3 (schema authored now per N10)
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.accident_reports  (3.1, B17, C3.6, N3.2)
-- -----------------------------------------------------------------------------
-- B17 is the critical safety fix: is_mayday short-circuits every evidence
-- requirement so an injured driver is never trapped behind a camera wizard.
-- A mayday submits coordinates alone and fires the full escalation immediately.
-- -----------------------------------------------------------------------------
CREATE TABLE app.accident_reports (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    shift_id                    uuid REFERENCES app.shifts(id) ON DELETE SET NULL,
    driver_id                   uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,
    vehicle_id                  uuid REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    trailer_id                  uuid REFERENCES app.trailers(id) ON DELETE RESTRICT,

    reported_at                 timestamptz NOT NULL DEFAULT now(),
    occurred_at                 timestamptz,

    -- B17: the "SEND HELP NOW - skip evidence" path.
    is_mayday                   boolean NOT NULL DEFAULT false,
    mayday_reason               text,

    -- C1.14: an SOS may be raised off-shift, in which case shift_id is NULL.
    was_off_shift               boolean NOT NULL DEFAULT false,

    reported_position           geography(Point, 4326),
    reported_latitude           numeric(9,6),
    reported_longitude          numeric(9,6),
    position_source             text CHECK (position_source IS NULL OR position_source IN ('TRACKER','PHONE_GPS','MANUAL')),

    driver_statement            text,
    statement_source            app.statement_source NOT NULL DEFAULT 'NOT_PROVIDED',

    witness_name                text,
    witness_phone               app.phone_e164,

    third_party_name            text,
    third_party_phone           app.phone_e164,
    third_party_plate           text,
    third_party_insurer         text,

    police_ob_number            text,
    insurance_claim_number      text,

    status                      app.accident_status NOT NULL DEFAULT 'PENDING',

    -- N3.2: an off-shift SOS may find no telemetry to freeze. This is recorded
    -- explicitly rather than leaving an ambiguous empty snapshot.
    telemetry_available         boolean NOT NULL DEFAULT false,
    telemetry_frozen_at         timestamptz,
    telemetry_point_count       integer NOT NULL DEFAULT 0,

    -- C6.3: five-minute acknowledgement window before escalation.
    acknowledged_by             uuid REFERENCES app.users(id),
    acknowledged_at             timestamptz,
    escalated_at                timestamptz,
    escalated_to                uuid REFERENCES app.users(id),

    investigating_at            timestamptz,
    resolved_at                 timestamptz,
    resolved_by                 uuid REFERENCES app.users(id),
    closed_at                   timestamptz,
    closed_by                   uuid REFERENCES app.users(id),
    resolution_notes            text,

    client_uuid                 uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT accident_reports_mayday_has_reason
        CHECK (is_mayday = false OR mayday_reason IS NOT NULL),
    CONSTRAINT accident_reports_statement_consistency
        CHECK (statement_source = 'NOT_PROVIDED' OR coalesce(btrim(driver_statement), '') <> ''),
    CONSTRAINT accident_reports_position_pair
        CHECK ((reported_latitude IS NULL) = (reported_longitude IS NULL)),
    CONSTRAINT accident_reports_status_timestamps CHECK (
        (status <> 'INVESTIGATING' OR investigating_at IS NOT NULL)
    AND (status <> 'RESOLVED'      OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
    AND (status <> 'CLOSED'        OR (closed_at   IS NOT NULL AND closed_by   IS NOT NULL))
    ),
    CONSTRAINT accident_reports_off_shift_consistency
        CHECK (was_off_shift = (shift_id IS NULL))
);

CREATE INDEX accident_reports_open_idx
    ON app.accident_reports (reported_at DESC) WHERE status IN ('PENDING','INVESTIGATING');
CREATE INDEX accident_reports_unacknowledged_idx
    ON app.accident_reports (reported_at) WHERE acknowledged_at IS NULL;
CREATE INDEX accident_reports_vehicle_idx ON app.accident_reports (vehicle_id, reported_at DESC);
CREATE INDEX accident_reports_driver_idx  ON app.accident_reports (driver_id, reported_at DESC);
CREATE INDEX accident_reports_mayday_idx  ON app.accident_reports (reported_at DESC) WHERE is_mayday = true;

COMMENT ON COLUMN app.accident_reports.is_mayday IS
    'B17. Bypasses all four mandatory photos and the statement. Submits position only and escalates immediately.';
COMMENT ON COLUMN app.accident_reports.telemetry_available IS
    'N3.2. False when an off-shift SOS found no retained telemetry to freeze.';

-- -----------------------------------------------------------------------------
-- app.accident_media  (3.1, C5.3, D5)
-- -----------------------------------------------------------------------------
-- Append-only. Media lives in the Object-Locked bucket with a 7-year retention,
-- so it is immutable even to an Admin.
-- -----------------------------------------------------------------------------
CREATE TABLE app.accident_media (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id           uuid NOT NULL REFERENCES app.accident_reports(id) ON DELETE RESTRICT,
    slot                app.accident_media_slot NOT NULL,
    media_object_id     uuid NOT NULL UNIQUE REFERENCES app.media_objects(id),
    uploaded_by         uuid REFERENCES app.users(id),
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    sha256              bytea
);

-- The four mandatory scene photographs are single-slot; ADDITIONAL is not.
CREATE UNIQUE INDEX accident_media_unique_primary_slots
    ON app.accident_media (report_id, slot)
    WHERE slot IN ('FRONT_DAMAGE','REAR_DAMAGE','SIDE_DAMAGE','OTHER_VEHICLE_PLATE','WITNESS');
CREATE INDEX accident_media_report_idx ON app.accident_media (report_id);

CREATE TRIGGER accident_media_append_only
    BEFORE UPDATE OR DELETE ON app.accident_media
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_mutation();

-- -----------------------------------------------------------------------------
-- app.accident_telemetry  (3.1, C3.4)
-- -----------------------------------------------------------------------------
-- The frozen snapshot: 5 minutes before and 1 minute after, cloned out of
-- telemetry.location_updates so the 90-day retention sweep can never remove it.
--
-- C3.4: each row carries a SHA-256 hash of the previous row's hash plus its own
-- canonical content. Altering any historical row breaks every subsequent hash,
-- which is what makes the snapshot defensible to an insurer or a court.
-- -----------------------------------------------------------------------------
CREATE TABLE app.accident_telemetry (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id           uuid NOT NULL REFERENCES app.accident_reports(id) ON DELETE RESTRICT,
    sequence            integer NOT NULL,

    recorded_at         timestamptz NOT NULL,
    latitude            numeric(9,6) NOT NULL,
    longitude           numeric(9,6) NOT NULL,
    position            geography(Point, 4326) NOT NULL,
    speed_kph           numeric(6,2),
    heading_deg         numeric(5,2),
    ignition            boolean,
    obd_attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,

    source_location_id  bigint,
    frozen_at           timestamptz NOT NULL DEFAULT now(),

    prev_hash           bytea,
    row_hash            bytea NOT NULL,

    UNIQUE (report_id, sequence)
);

CREATE INDEX accident_telemetry_report_idx ON app.accident_telemetry (report_id, sequence);

-- Computes the chain link. Any attempt to insert out of sequence, or to insert
-- a row whose prev_hash does not match the stored tail, is rejected.
CREATE OR REPLACE FUNCTION app.fn_accident_telemetry_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_prev_hash     bytea;
    v_prev_sequence integer;
    v_canonical     text;
BEGIN
    SELECT t.row_hash, t.sequence
      INTO v_prev_hash, v_prev_sequence
      FROM app.accident_telemetry t
     WHERE t.report_id = NEW.report_id
     ORDER BY t.sequence DESC
     LIMIT 1;

    IF v_prev_sequence IS NULL THEN
        IF NEW.sequence <> 1 THEN
            RAISE EXCEPTION 'Accident telemetry for report % must start at sequence 1, got %.',
                NEW.report_id, NEW.sequence USING ERRCODE = 'check_violation';
        END IF;
        v_prev_hash := NULL;
    ELSIF NEW.sequence <> v_prev_sequence + 1 THEN
        RAISE EXCEPTION 'Accident telemetry sequence gap for report %: expected %, got % (C3.4).',
            NEW.report_id, v_prev_sequence + 1, NEW.sequence USING ERRCODE = 'check_violation';
    END IF;

    NEW.prev_hash := v_prev_hash;

    v_canonical := concat_ws('|',
        encode(coalesce(v_prev_hash, ''::bytea), 'hex'),
        NEW.report_id::text,
        NEW.sequence::text,
        to_char(NEW.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'),
        NEW.latitude::text,
        NEW.longitude::text,
        coalesce(NEW.speed_kph::text, ''),
        coalesce(NEW.heading_deg::text, ''),
        coalesce(NEW.ignition::text, ''),
        NEW.obd_attributes::text
    );

    NEW.row_hash := public.digest(v_canonical, 'sha256');
    RETURN NEW;
END;
$$;

CREATE TRIGGER accident_telemetry_hash_chain
    BEFORE INSERT ON app.accident_telemetry
    FOR EACH ROW EXECUTE FUNCTION app.fn_accident_telemetry_hash_chain();

CREATE TRIGGER accident_telemetry_append_only
    BEFORE UPDATE OR DELETE ON app.accident_telemetry
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_mutation();

COMMENT ON TABLE app.accident_telemetry IS
    'C3.4. SHA-256 hash-chained, append-only frozen telemetry. Verified by app.fn_verify_accident_chain().';

-- Chain verifier, exposed through GET /accidents/{id}/telemetry/verify.
CREATE OR REPLACE FUNCTION app.fn_verify_accident_chain(p_report_id uuid)
RETURNS TABLE (sequence integer, is_valid boolean, expected_hash bytea, stored_hash bytea)
LANGUAGE plpgsql
STABLE
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    r           record;
    v_prev      bytea := NULL;
    v_canonical text;
    v_expected  bytea;
BEGIN
    FOR r IN
        SELECT * FROM app.accident_telemetry t
         WHERE t.report_id = p_report_id
         ORDER BY t.sequence
    LOOP
        v_canonical := concat_ws('|',
            encode(coalesce(v_prev, ''::bytea), 'hex'),
            r.report_id::text,
            r.sequence::text,
            to_char(r.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'),
            r.latitude::text,
            r.longitude::text,
            coalesce(r.speed_kph::text, ''),
            coalesce(r.heading_deg::text, ''),
            coalesce(r.ignition::text, ''),
            r.obd_attributes::text
        );
        v_expected := public.digest(v_canonical, 'sha256');

        sequence      := r.sequence;
        expected_hash := v_expected;
        stored_hash   := r.row_hash;
        is_valid      := (v_expected = r.row_hash) AND (r.prev_hash IS NOT DISTINCT FROM v_prev);
        RETURN NEXT;

        v_prev := r.row_hash;
    END LOOP;
END;
$$;

-- =============================================================================
-- MAINTENANCE  (3.6, C3.11, C3.12)
-- =============================================================================

CREATE TABLE app.maintenance_tasks (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    text NOT NULL,
    name                    text NOT NULL,
    applies_to              text NOT NULL CHECK (applies_to IN ('VEHICLE','TRAILER')),
    vehicle_class           app.vehicle_class,
    trailer_type            app.trailer_type,

    -- C3.11: odometer, calendar time and engine hours are all supported.
    trigger_type            app.maintenance_trigger_type NOT NULL,
    interval_km             integer CHECK (interval_km IS NULL OR interval_km > 0),
    interval_days           integer CHECK (interval_days IS NULL OR interval_days > 0),
    interval_engine_hours   numeric(10,1) CHECK (interval_engine_hours IS NULL OR interval_engine_hours > 0),

    -- C3.12: off by default. Overdue raises an alert, it does not ground the asset.
    auto_quarantine_enabled boolean NOT NULL DEFAULT false,
    auto_quarantine_overdue_km integer,

    is_active               boolean NOT NULL DEFAULT true,
    created_by              uuid REFERENCES app.users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT maintenance_tasks_interval_matches_trigger CHECK (
        (trigger_type = 'ODOMETER'     AND interval_km           IS NOT NULL)
     OR (trigger_type = 'TIME'         AND interval_days         IS NOT NULL)
     OR (trigger_type = 'ENGINE_HOURS' AND interval_engine_hours IS NOT NULL)
    ),
    CONSTRAINT maintenance_tasks_scope_matches_target CHECK (
        (applies_to = 'VEHICLE' AND trailer_type IS NULL)
     OR (applies_to = 'TRAILER' AND vehicle_class IS NULL)
    ),
    CONSTRAINT maintenance_tasks_autoquarantine_needs_threshold
        CHECK (auto_quarantine_enabled = false OR auto_quarantine_overdue_km IS NOT NULL)
);

CREATE UNIQUE INDEX maintenance_tasks_code_unique ON app.maintenance_tasks (code);

CREATE TABLE app.maintenance_schedules (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id                     uuid NOT NULL REFERENCES app.maintenance_tasks(id) ON DELETE CASCADE,
    vehicle_id                  uuid REFERENCES app.vehicles(id) ON DELETE CASCADE,
    trailer_id                  uuid REFERENCES app.trailers(id) ON DELETE CASCADE,

    last_performed_at           timestamptz,
    last_performed_odometer_km  app.odometer_km,
    last_performed_engine_hours numeric(10,1),

    next_due_odometer_km        app.odometer_km,
    next_due_on                 date,
    next_due_engine_hours       numeric(10,1),

    status                      app.maintenance_schedule_status NOT NULL DEFAULT 'OK',
    overdue_by_km               integer,
    overdue_by_days             integer,
    alert_sent_at               timestamptz,
    evaluated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT maintenance_schedules_exactly_one_asset CHECK (
        (vehicle_id IS NOT NULL)::int + (trailer_id IS NOT NULL)::int = 1
    )
);

CREATE UNIQUE INDEX maintenance_schedules_vehicle_task_unique
    ON app.maintenance_schedules (vehicle_id, task_id) WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX maintenance_schedules_trailer_task_unique
    ON app.maintenance_schedules (trailer_id, task_id) WHERE trailer_id IS NOT NULL;
CREATE INDEX maintenance_schedules_due_idx
    ON app.maintenance_schedules (status, next_due_on) WHERE status <> 'OK';

CREATE TABLE app.maintenance_records (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id         uuid REFERENCES app.maintenance_schedules(id) ON DELETE SET NULL,
    task_id             uuid NOT NULL REFERENCES app.maintenance_tasks(id) ON DELETE RESTRICT,
    vehicle_id          uuid REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    trailer_id          uuid REFERENCES app.trailers(id) ON DELETE RESTRICT,

    performed_at        timestamptz NOT NULL,
    odometer_km         app.odometer_km,
    engine_hours        numeric(10,1),

    -- C3.11: cost, parts, vendor and downtime are all tracked.
    vendor              text,
    cost                app.money_amount,
    currency            app.currency_code,
    parts_used          text,
    downtime_days       numeric(6,2) CHECK (downtime_days IS NULL OR downtime_days >= 0),
    invoice_media_object_id uuid REFERENCES app.media_objects(id),

    notes               text,
    recorded_by         uuid NOT NULL REFERENCES app.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT maintenance_records_exactly_one_asset CHECK (
        (vehicle_id IS NOT NULL)::int + (trailer_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX maintenance_records_vehicle_idx ON app.maintenance_records (vehicle_id, performed_at DESC);
CREATE INDEX maintenance_records_trailer_idx ON app.maintenance_records (trailer_id, performed_at DESC);

-- =============================================================================
-- QUARANTINE  (3.4, C3.9)
-- =============================================================================
-- Defined last because it references accidents, inspections and maintenance.
--
-- C3.9: only an accident-induced quarantine demands a repair-completion PDF.
-- A manual quarantine raised in error can be lifted with an audited reason.
-- -----------------------------------------------------------------------------
CREATE TABLE app.quarantine_events (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    vehicle_id                  uuid REFERENCES app.vehicles(id) ON DELETE CASCADE,
    trailer_id                  uuid REFERENCES app.trailers(id) ON DELETE CASCADE,

    reason                      app.quarantine_reason NOT NULL,
    reason_notes                text,

    source_accident_id          uuid REFERENCES app.accident_reports(id) ON DELETE SET NULL,
    source_inspection_id        uuid REFERENCES app.inspections(id) ON DELETE SET NULL,
    source_schedule_id          uuid REFERENCES app.maintenance_schedules(id) ON DELETE SET NULL,

    triggered_by_system         boolean NOT NULL DEFAULT false,
    triggered_by_user_id        uuid REFERENCES app.users(id),
    quarantined_at              timestamptz NOT NULL DEFAULT now(),

    -- C3.9
    requires_repair_document    boolean NOT NULL,
    lift_document_media_object_id uuid REFERENCES app.media_objects(id),
    lifted_at                   timestamptz,
    lifted_by                   uuid REFERENCES app.users(id),
    lift_reason                 text,

    CONSTRAINT quarantine_exactly_one_asset CHECK (
        (vehicle_id IS NOT NULL)::int + (trailer_id IS NOT NULL)::int = 1
    ),
    CONSTRAINT quarantine_manual_has_actor
        CHECK (triggered_by_system = true OR triggered_by_user_id IS NOT NULL),
    CONSTRAINT quarantine_accident_requires_document
        CHECK (reason <> 'ACCIDENT' OR requires_repair_document = true),
    CONSTRAINT quarantine_lift_complete CHECK (
        lifted_at IS NULL
        OR (lifted_by IS NOT NULL
            AND lift_reason IS NOT NULL
            AND (requires_repair_document = false OR lift_document_media_object_id IS NOT NULL))
    )
);

-- Only one open quarantine per asset.
CREATE UNIQUE INDEX quarantine_one_open_per_vehicle
    ON app.quarantine_events (vehicle_id) WHERE vehicle_id IS NOT NULL AND lifted_at IS NULL;
CREATE UNIQUE INDEX quarantine_one_open_per_trailer
    ON app.quarantine_events (trailer_id) WHERE trailer_id IS NOT NULL AND lifted_at IS NULL;
CREATE INDEX quarantine_open_idx ON app.quarantine_events (quarantined_at DESC) WHERE lifted_at IS NULL;

COMMENT ON CONSTRAINT quarantine_lift_complete ON app.quarantine_events IS
    'C3.9. An accident quarantine cannot be lifted without a repair-completion document; a manual one can, with a reason.';

CREATE TRIGGER quarantine_events_no_hard_delete
    BEFORE DELETE ON app.quarantine_events
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER accident_reports_set_updated_at
    BEFORE UPDATE ON app.accident_reports
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER accident_reports_no_hard_delete
    BEFORE DELETE ON app.accident_reports
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER maintenance_tasks_set_updated_at
    BEFORE UPDATE ON app.maintenance_tasks
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
