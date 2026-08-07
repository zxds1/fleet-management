-- =============================================================================
-- 06_telemetry_hos.sql
-- Fleet Management Platform - Telemetry ingestion store, tracker health,
--                             off-shift movement, and the driver duty ledger
--
-- Decisions: A1.1, A1.2, A2.4, B10, C1.9, C1.10, C3.1-C3.3, C5.6, C5.9,
--            D6, N2.3, N3, N5, N7, N8, M3
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- telemetry.location_updates
-- -----------------------------------------------------------------------------
-- Positions decoded by Traccar and relayed through the durable Redis Stream
-- (N2.3). Partitioned monthly so the 90-day retention worker can DROP whole
-- partitions instead of deleting rows (D6).
--
-- C5.6/N3: only positions inside the retained window are written at all. The
-- window is clock_in - 15 min .. clock_out + 15 min (N3.3), extended by an
-- active recovery mode (N3.1) or an accident freeze (N3.2). Everything else is
-- discarded at the consumer and never reaches this table.
--
-- An explicit sequence is used rather than an identity column because the
-- default must be inherited cleanly by every partition.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE telemetry.location_updates_id_seq AS bigint;

CREATE TABLE telemetry.location_updates (
    id                      bigint NOT NULL DEFAULT nextval('telemetry.location_updates_id_seq'),
    vehicle_id              uuid NOT NULL,
    shift_id                uuid,

    recorded_at             timestamptz NOT NULL,   -- device clock, partition key
    received_at             timestamptz NOT NULL DEFAULT now(),

    position                geography(Point, 4326) NOT NULL,
    latitude                numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude               numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    speed_kph               numeric(6,2) CHECK (speed_kph IS NULL OR speed_kph >= 0),
    heading_deg             numeric(5,2) CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
    altitude_m              numeric(7,2),

    -- The single most important field in the platform: driving time, geofence
    -- auto-clockout, HOS and the map legend all derive from it (C1.9).
    ignition                boolean,

    -- A1.2/M3: OBD values are advisory cross-checks only. The driver's
    -- photographed odometer and gauge selection remain authoritative.
    obd_odometer_km         integer CHECK (obd_odometer_km IS NULL OR obd_odometer_km >= 0),
    obd_engine_hours        numeric(10,1),
    obd_fuel_level_percent  numeric(5,2) CHECK (obd_fuel_level_percent IS NULL OR obd_fuel_level_percent BETWEEN 0 AND 100),
    obd_fault_codes         text[],

    satellites              smallint,
    hdop                    numeric(4,1),
    is_valid_fix            boolean NOT NULL DEFAULT true,

    traccar_position_id     bigint,
    traccar_device_id       integer,
    attributes              jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Why this row was allowed to persist under the C5.6 discard rule.
    retention_reason        text NOT NULL DEFAULT 'SHIFT'
                            CHECK (retention_reason IN ('SHIFT','SHIFT_BUFFER','RECOVERY_MODE','ACCIDENT_FREEZE')),

    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

ALTER SEQUENCE telemetry.location_updates_id_seq OWNED BY telemetry.location_updates.id;

-- Spec 5.4: "Indexed by (vehicle_id, recorded_at DESC)".
CREATE INDEX location_updates_vehicle_time_idx
    ON telemetry.location_updates (vehicle_id, recorded_at DESC);
CREATE INDEX location_updates_shift_time_idx
    ON telemetry.location_updates (shift_id, recorded_at)
    WHERE shift_id IS NOT NULL;
CREATE INDEX location_updates_position_gist
    ON telemetry.location_updates USING gist (position);
-- N2.3: makes the reconciliation back-fill poller idempotent.
CREATE UNIQUE INDEX location_updates_traccar_dedupe
    ON telemetry.location_updates (traccar_position_id, recorded_at)
    WHERE traccar_position_id IS NOT NULL;

COMMENT ON TABLE telemetry.location_updates IS
    'Raw GPS. Monthly partitions, 90-day retention by partition DROP (D6). Off-shift positions are never inserted (C5.6/N3).';
COMMENT ON COLUMN telemetry.location_updates.shift_id IS
    'Deliberately not a foreign key: partition-wide FK enforcement is too costly at 1.7M rows/day (A2.4). Referential integrity is maintained by the consumer.';
COMMENT ON COLUMN telemetry.location_updates.obd_fuel_level_percent IS
    'M3. Advisory only. Divergence from the driver gauge raises GAUGE_OBD_DIVERGENCE; it never blocks.';

-- -----------------------------------------------------------------------------
-- telemetry.location_summaries  (7.3)
-- -----------------------------------------------------------------------------
-- Five-minute aggregates written by the archiver before raw partitions are
-- dropped. These survive the 90-day cut so historic route analytics and
-- distance reconstruction remain possible.
-- -----------------------------------------------------------------------------
CREATE TABLE telemetry.location_summaries (
    vehicle_id              uuid NOT NULL,
    bucket_start            timestamptz NOT NULL,
    bucket_seconds          smallint NOT NULL DEFAULT 300,
    shift_id                uuid,

    point_count             integer NOT NULL,
    avg_speed_kph           numeric(6,2),
    max_speed_kph           numeric(6,2),
    distance_km             numeric(10,3) NOT NULL DEFAULT 0,
    ignition_on_seconds     integer NOT NULL DEFAULT 0,
    moving_seconds          integer NOT NULL DEFAULT 0,
    idle_seconds            integer NOT NULL DEFAULT 0,

    start_position          geography(Point, 4326),
    end_position            geography(Point, 4326),
    created_at              timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (vehicle_id, bucket_start)
);

CREATE INDEX location_summaries_shift_idx  ON telemetry.location_summaries (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX location_summaries_time_idx   ON telemetry.location_summaries (bucket_start DESC);

-- -----------------------------------------------------------------------------
-- app.tracker_health  (C1.9, C1.10, C3.8, N5)
-- -----------------------------------------------------------------------------
-- Drives the OFFLINE map colour and the degraded-mode banner in the driver app.
-- -----------------------------------------------------------------------------
CREATE TABLE app.tracker_health (
    vehicle_id                  uuid PRIMARY KEY REFERENCES app.vehicles(id) ON DELETE CASCADE,
    traccar_device_id           integer,
    last_position_at            timestamptz,
    last_heartbeat_at           timestamptz,
    last_ignition               boolean,
    last_speed_kph              numeric(6,2),
    last_position               geography(Point, 4326),

    is_online                   boolean NOT NULL DEFAULT false,
    offline_since               timestamptz,
    consecutive_missed_windows  integer NOT NULL DEFAULT 0,
    offline_alert_sent_at       timestamptz,

    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracker_health_offline_idx ON app.tracker_health (offline_since) WHERE is_online = false;

COMMENT ON TABLE app.tracker_health IS
    'Hot per-vehicle tracker state. Mirrored into the Redis hash vehicle:{id}:state for the live map (5.5).';

-- -----------------------------------------------------------------------------
-- app.vehicle_movement_events  (C5.6, N3)
-- -----------------------------------------------------------------------------
-- Records THAT a vehicle moved off-shift, deliberately without recording WHERE.
-- This is the privacy-preserving half of C5.6; app.recovery_modes (N3.1) is the
-- audited escape hatch when location genuinely must be retained.
-- -----------------------------------------------------------------------------
CREATE TABLE app.vehicle_movement_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
    event_type      text NOT NULL CHECK (event_type IN ('OFF_SHIFT_MOVEMENT_START','OFF_SHIFT_MOVEMENT_END')),
    occurred_at     timestamptz NOT NULL,
    detected_at     timestamptz NOT NULL DEFAULT now(),
    duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    alert_sent_at   timestamptz,
    acknowledged_by uuid REFERENCES app.users(id),
    acknowledged_at timestamptz,
    notes           text
);

CREATE INDEX vehicle_movement_events_vehicle_idx ON app.vehicle_movement_events (vehicle_id, occurred_at DESC);
CREATE INDEX vehicle_movement_events_unack_idx   ON app.vehicle_movement_events (occurred_at DESC)
                                                    WHERE acknowledged_at IS NULL;

COMMENT ON TABLE app.vehicle_movement_events IS
    'C5.6/N3. Timestamp-only record of unauthorised off-shift movement. No coordinates are stored by design.';

-- =============================================================================
-- HOURS OF SERVICE  (N7, N8, C3.1-C3.3)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app.hos_policies  (C3.1, C3.2)
-- -----------------------------------------------------------------------------
-- NTSA-aligned defaults, fully configurable. One row is the global default;
-- app.drivers.hos_policy_id may point at an alternative for a specific driver,
-- which requires a reason and is audited.
-- -----------------------------------------------------------------------------
CREATE TABLE app.hos_policies (
    id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                                text NOT NULL,
    is_default                          boolean NOT NULL DEFAULT false,

    max_driving_seconds_per_day         integer NOT NULL DEFAULT 28800,   -- 8 h
    max_duty_seconds_per_shift          integer NOT NULL DEFAULT 50400,   -- 14 h
    duty_warning_seconds                integer NOT NULL DEFAULT 43200,   -- 12 h
    continuous_driving_before_break_seconds integer NOT NULL DEFAULT 14400, -- 4 h
    min_break_seconds                   integer NOT NULL DEFAULT 1800,    -- 30 min
    min_daily_rest_seconds              integer NOT NULL DEFAULT 36000,   -- 10 h
    min_weekly_rest_seconds             integer NOT NULL DEFAULT 86400,   -- 24 h
    weekly_window_days                  smallint NOT NULL DEFAULT 7,
    warning_lead_seconds                integer NOT NULL DEFAULT 1800,    -- "rest in 30 minutes"

    effective_from                      date NOT NULL DEFAULT CURRENT_DATE,
    effective_to                        date,
    notes                               text,
    created_by                          uuid REFERENCES app.users(id),
    created_at                          timestamptz NOT NULL DEFAULT now(),
    updated_at                          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT hos_policies_positive CHECK (
        max_driving_seconds_per_day > 0
    AND max_duty_seconds_per_shift > 0
    AND duty_warning_seconds > 0
    AND continuous_driving_before_break_seconds > 0
    AND min_break_seconds > 0
    AND min_daily_rest_seconds > 0
    AND min_weekly_rest_seconds > 0
    AND warning_lead_seconds >= 0
    ),
    CONSTRAINT hos_policies_warning_before_limit
        CHECK (duty_warning_seconds < max_duty_seconds_per_shift),
    CONSTRAINT hos_policies_driving_within_duty
        CHECK (max_driving_seconds_per_day <= max_duty_seconds_per_shift),
    CONSTRAINT hos_policies_effective_range
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX hos_policies_single_default ON app.hos_policies (is_default) WHERE is_default = true;

COMMENT ON TABLE app.hos_policies IS
    'C3.1. NTSA-aligned defaults. Legal verification of these figures is a client responsibility (see risk register R-011).';

ALTER TABLE app.drivers
    ADD CONSTRAINT drivers_hos_policy_fk
    FOREIGN KEY (hos_policy_id) REFERENCES app.hos_policies(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- app.driver_duty_segments  (N7, N8)
-- -----------------------------------------------------------------------------
-- The ledger that makes HOS driver-centric instead of shift-centric. Under the
-- old per-shift design a driver could drive 7 h, swap tractors (C1.7), and drive
-- another 7 h while every individual shift stayed under the 8 h cap. Aggregating
-- here closes that gap.
--
-- The EXCLUDE constraint makes overlapping duty segments impossible at the
-- database level, which is what allows the rolling sums to be trusted.
-- -----------------------------------------------------------------------------
CREATE TABLE app.driver_duty_segments (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id               uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
    shift_id                uuid REFERENCES app.shifts(id) ON DELETE SET NULL,
    vehicle_id              uuid REFERENCES app.vehicles(id) ON DELETE SET NULL,

    status                  app.duty_status NOT NULL,
    started_at              timestamptz NOT NULL,
    ended_at                timestamptz,
    duration_seconds        integer GENERATED ALWAYS AS (
                                CASE WHEN ended_at IS NULL THEN NULL
                                     ELSE (EXTRACT(EPOCH FROM (ended_at - started_at)))::integer
                                END
                            ) STORED,

    source                  app.duty_segment_source NOT NULL DEFAULT 'TELEMETRY_INFERRED',
    -- N8: an inferred BREAK may be confirmed or reclassified by the driver.
    is_inferred             boolean NOT NULL DEFAULT true,
    confirmed_by_driver_at  timestamptz,
    reclassified_from       app.duty_status,
    corrected_by            uuid REFERENCES app.users(id),
    corrected_at            timestamptz,
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT duty_segments_time_order CHECK (ended_at IS NULL OR ended_at > started_at),
    CONSTRAINT duty_segments_correction_complete
        CHECK (corrected_at IS NULL OR corrected_by IS NOT NULL),

    -- Requires btree_gist for the uuid equality operator.
    CONSTRAINT duty_segments_no_overlap EXCLUDE USING gist (
        driver_id WITH =,
        tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&
    )
);

CREATE INDEX duty_segments_driver_time_idx  ON app.driver_duty_segments (driver_id, started_at DESC);
CREATE INDEX duty_segments_open_idx         ON app.driver_duty_segments (driver_id) WHERE ended_at IS NULL;
CREATE INDEX duty_segments_shift_idx        ON app.driver_duty_segments (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX duty_segments_driving_idx      ON app.driver_duty_segments (driver_id, started_at DESC)
                                               WHERE status = 'DRIVING';
CREATE INDEX duty_segments_unconfirmed_break_idx
    ON app.driver_duty_segments (driver_id, started_at DESC)
    WHERE status = 'BREAK' AND is_inferred = true AND confirmed_by_driver_at IS NULL;

COMMENT ON TABLE app.driver_duty_segments IS
    'N7/N8. Append-mostly duty ledger. Non-overlap is enforced by an exclusion constraint so rolling HOS sums are provably correct.';

-- -----------------------------------------------------------------------------
-- app.driver_hos_state  (C3.3)
-- -----------------------------------------------------------------------------
-- Materialised rolling position, recomputed by the 5-minute compliance worker
-- and read synchronously by the clock-in service to enforce the hard block.
-- -----------------------------------------------------------------------------
CREATE TABLE app.driver_hos_state (
    driver_id                       uuid PRIMARY KEY REFERENCES app.drivers(id) ON DELETE CASCADE,
    policy_id                       uuid NOT NULL REFERENCES app.hos_policies(id),

    driving_seconds_today           integer NOT NULL DEFAULT 0,
    duty_seconds_today              integer NOT NULL DEFAULT 0,
    driving_seconds_since_break     integer NOT NULL DEFAULT 0,
    last_break_ended_at             timestamptz,

    last_off_duty_started_at        timestamptz,
    last_off_duty_seconds           integer,
    weekly_rest_satisfied           boolean NOT NULL DEFAULT true,
    weekly_rest_last_completed_at   timestamptz,

    -- C3.3: hard block. The clock-in service refuses until now() >= this value.
    next_eligible_clock_in_at       timestamptz,
    block_reason                    app.hos_violation_type,

    warning_sent_at                 timestamptz,
    limit_reached_at                timestamptz,

    computed_at                     timestamptz NOT NULL DEFAULT now(),
    computed_through                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT driver_hos_state_nonnegative CHECK (
        driving_seconds_today >= 0
    AND duty_seconds_today >= 0
    AND driving_seconds_since_break >= 0
    )
);

CREATE INDEX driver_hos_state_blocked_idx
    ON app.driver_hos_state (next_eligible_clock_in_at)
    WHERE next_eligible_clock_in_at IS NOT NULL;
CREATE INDEX driver_hos_state_alerting_idx
    ON app.driver_hos_state (limit_reached_at) WHERE limit_reached_at IS NOT NULL;

COMMENT ON COLUMN app.driver_hos_state.next_eligible_clock_in_at IS
    'C3.3 hard block. The driver app renders this as a rest countdown.';

-- -----------------------------------------------------------------------------
-- app.hos_violations
-- -----------------------------------------------------------------------------
CREATE TABLE app.hos_violations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
    shift_id            uuid REFERENCES app.shifts(id) ON DELETE SET NULL,
    policy_id           uuid NOT NULL REFERENCES app.hos_policies(id),

    violation_type      app.hos_violation_type NOT NULL,
    threshold_seconds   integer NOT NULL,
    actual_seconds      integer NOT NULL,
    occurred_at         timestamptz NOT NULL,
    detected_at         timestamptz NOT NULL DEFAULT now(),

    acknowledged_by     uuid REFERENCES app.users(id),
    acknowledged_at     timestamptz,
    notes               text
);

CREATE INDEX hos_violations_driver_idx ON app.hos_violations (driver_id, occurred_at DESC);
CREATE INDEX hos_violations_open_idx   ON app.hos_violations (occurred_at DESC) WHERE acknowledged_at IS NULL;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER hos_policies_set_updated_at
    BEFORE UPDATE ON app.hos_policies
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER hos_policies_no_hard_delete
    BEFORE DELETE ON app.hos_policies
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER tracker_health_set_updated_at
    BEFORE UPDATE ON app.tracker_health
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
