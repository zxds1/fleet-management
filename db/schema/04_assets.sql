-- =============================================================================
-- 04_assets.sql
-- Fleet Management Platform - Geofences, vehicles, trailers, documents,
--                             dispatch assignments, recovery mode
--
-- Decisions: A1.1, A1.3, B14, B15, C1.11, C3.7, C3.10, C4.1, C4.2, C4.4,
--            N2.1, N3.1
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.geofences  (C3.7)
-- -----------------------------------------------------------------------------
-- Polygons are drawn in the Admin web on a Google Map and stored as PostGIS
-- geography so that ST_DWithin / ST_Covers work in metres without projection
-- juggling. Only YARD geofences are eligible for auto-clockout (A1.7).
-- -----------------------------------------------------------------------------
CREATE TABLE app.geofences (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    kind            app.geofence_kind NOT NULL DEFAULT 'YARD',
    boundary        geography(Polygon, 4326) NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    notes           text,
    created_by      uuid REFERENCES app.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE UNIQUE INDEX geofences_name_unique
    ON app.geofences (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX geofences_boundary_gist
    ON app.geofences USING gist (boundary);
CREATE INDEX geofences_active_yard_idx
    ON app.geofences (kind) WHERE is_active = true AND deleted_at IS NULL;

COMMENT ON TABLE app.geofences IS
    'Yard, customer and restricted-zone polygons. Only kind = YARD triggers auto-clockout (A1.7).';

-- -----------------------------------------------------------------------------
-- app.vehicles  (C4.1, C4.2, C4.4, A1.3, N2.1, B6)
-- -----------------------------------------------------------------------------
CREATE TABLE app.vehicles (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    license_plate               app.license_plate NOT NULL,
    vehicle_class               app.vehicle_class NOT NULL DEFAULT 'TRACTOR',
    make                        text,
    model                       text,
    year                        smallint CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
    ownership_type              app.ownership_type NOT NULL DEFAULT 'OWNED',

    -- A1.3: Admin-entered at onboarding. Never auto-derived (M1).
    -- Mandatory because the whole fuel-fraud calculation divides by it.
    fuel_tank_capacity_litres   numeric(7,2) NOT NULL
                                CHECK (fuel_tank_capacity_litres > 0
                                       AND fuel_tank_capacity_litres <= 5000),

    -- C4.2: maintained from the driver's photographed reading, never from OBD.
    current_odometer_km         app.odometer_km NOT NULL DEFAULT 0,
    current_odometer_at         timestamptz,
    engine_hours                numeric(10,1) CHECK (engine_hours IS NULL OR engine_hours >= 0),

    -- N2.1: our database owns the asset; Traccar owns the device. Provisioning is
    -- one-way (our API -> Traccar REST API), and the returned id is stored here.
    tracker_imei                text CHECK (tracker_imei IS NULL OR tracker_imei ~ '^[0-9]{14,17}$'),
    traccar_device_id           integer,
    tracker_provisioned_at      timestamptz,

    home_geofence_id            uuid REFERENCES app.geofences(id) ON DELETE SET NULL,

    status                      app.asset_status NOT NULL DEFAULT 'AVAILABLE',

    -- 3.5: set false by the document-expiry worker. Independent of quarantine:
    -- an asset can be blocked by documents AND quarantined at the same time,
    -- and lifting one must not silently unblock the other (N-review of C3.9).
    is_operational              boolean NOT NULL DEFAULT true,
    non_operational_reason      text,

    -- 1.1: denormalised pointer for the dispatch board and the live map.
    current_driver_id           uuid,   -- FK added in 05_operations.sql (drivers exist, shifts do not yet)

    -- B6: per-vehicle rolling baseline, recomputed daily over the last 30 shifts
    -- with a minimum sample of 5, falling back to the fleet-wide figure.
    baseline_l_per_100km        numeric(6,2) CHECK (baseline_l_per_100km IS NULL OR baseline_l_per_100km > 0),
    baseline_sample_size        smallint NOT NULL DEFAULT 0,
    baseline_scope              text NOT NULL DEFAULT 'NONE'
                                CHECK (baseline_scope IN ('NONE','VEHICLE','FLEET')),
    baseline_computed_at        timestamptz,

    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    deleted_at                  timestamptz,

    CONSTRAINT vehicles_tracker_pairing
        CHECK ((traccar_device_id IS NULL) OR (tracker_imei IS NOT NULL)),
    CONSTRAINT vehicles_non_operational_has_reason
        CHECK (is_operational = true OR non_operational_reason IS NOT NULL)
);

CREATE UNIQUE INDEX vehicles_plate_unique
    ON app.vehicles (license_plate) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_imei_unique
    ON app.vehicles (tracker_imei) WHERE tracker_imei IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_traccar_device_unique
    ON app.vehicles (traccar_device_id) WHERE traccar_device_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX vehicles_status_idx
    ON app.vehicles (status) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_dispatchable_idx
    ON app.vehicles (status, is_operational)
    WHERE deleted_at IS NULL AND status = 'AVAILABLE' AND is_operational = true;
CREATE INDEX vehicles_plate_trgm
    ON app.vehicles USING gin (license_plate gin_trgm_ops);

COMMENT ON COLUMN app.vehicles.fuel_tank_capacity_litres IS
    'A1.3/M1. Admin-entered. Denominator of the expected-gauge-rise calculation (2.5).';
COMMENT ON COLUMN app.vehicles.is_operational IS
    'Document-expiry block (3.5). Orthogonal to status = QUARANTINED; both must clear before dispatch.';

-- -----------------------------------------------------------------------------
-- app.trailers  (B15, C1.11, C4.4, M6)
-- -----------------------------------------------------------------------------
CREATE TABLE app.trailers (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    license_plate               app.license_plate NOT NULL,
    trailer_type                app.trailer_type NOT NULL,
    length_ft                   numeric(5,1) CHECK (length_ft IS NULL OR length_ft > 0),
    capacity_weight_kg          integer CHECK (capacity_weight_kg IS NULL OR capacity_weight_kg > 0),
    ownership_type              app.ownership_type NOT NULL DEFAULT 'OWNED',

    has_gps_tracker             boolean NOT NULL DEFAULT false,
    tracker_imei                text CHECK (tracker_imei IS NULL OR tracker_imei ~ '^[0-9]{14,17}$'),
    traccar_device_id           integer,

    status                      app.asset_status NOT NULL DEFAULT 'AVAILABLE',
    is_operational              boolean NOT NULL DEFAULT true,
    non_operational_reason      text,

    -- B15: which tractor is currently pulling this trailer.
    current_vehicle_id          uuid REFERENCES app.vehicles(id) ON DELETE SET NULL,

    -- M6: optional reefer set-point band used to validate the DVIR temperature input.
    reefer_target_temp_min_c    numeric(5,2) CHECK (reefer_target_temp_min_c IS NULL OR reefer_target_temp_min_c BETWEEN -40 AND 40),
    reefer_target_temp_max_c    numeric(5,2) CHECK (reefer_target_temp_max_c IS NULL OR reefer_target_temp_max_c BETWEEN -40 AND 40),

    -- C1.11: driver-created placeholder for a customer or third-party trailer.
    is_external                 boolean NOT NULL DEFAULT false,
    created_by_driver_id        uuid REFERENCES app.drivers(id) ON DELETE SET NULL,
    merged_into_trailer_id      uuid REFERENCES app.trailers(id) ON DELETE SET NULL,
    merged_at                   timestamptz,
    merged_by                   uuid REFERENCES app.users(id),

    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    deleted_at                  timestamptz,

    CONSTRAINT trailers_reefer_band_ordered
        CHECK (reefer_target_temp_min_c IS NULL
               OR reefer_target_temp_max_c IS NULL
               OR reefer_target_temp_min_c <= reefer_target_temp_max_c),
    CONSTRAINT trailers_reefer_band_only_for_reefer
        CHECK (trailer_type = 'REEFER'
               OR (reefer_target_temp_min_c IS NULL AND reefer_target_temp_max_c IS NULL)),
    CONSTRAINT trailers_external_flagging
        CHECK ((is_external = false) OR (status = 'EXTERNAL' OR merged_into_trailer_id IS NOT NULL)),
    CONSTRAINT trailers_merge_complete
        CHECK ((merged_into_trailer_id IS NULL) = (merged_at IS NULL)),
    CONSTRAINT trailers_no_self_merge
        CHECK (merged_into_trailer_id IS DISTINCT FROM id),
    CONSTRAINT trailers_tracker_pairing
        CHECK ((traccar_device_id IS NULL) OR (tracker_imei IS NOT NULL)),
    CONSTRAINT trailers_gps_flag_consistent
        CHECK (has_gps_tracker = (tracker_imei IS NOT NULL)),
    CONSTRAINT trailers_non_operational_has_reason
        CHECK (is_operational = true OR non_operational_reason IS NOT NULL)
);

CREATE UNIQUE INDEX trailers_plate_unique
    ON app.trailers (license_plate) WHERE deleted_at IS NULL AND merged_into_trailer_id IS NULL;
CREATE UNIQUE INDEX trailers_imei_unique
    ON app.trailers (tracker_imei) WHERE tracker_imei IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX trailers_status_idx
    ON app.trailers (status) WHERE deleted_at IS NULL;
CREATE INDEX trailers_current_vehicle_idx
    ON app.trailers (current_vehicle_id) WHERE current_vehicle_id IS NOT NULL;
CREATE INDEX trailers_external_pending_merge_idx
    ON app.trailers (created_at) WHERE is_external = true AND merged_into_trailer_id IS NULL;
CREATE INDEX trailers_plate_trgm
    ON app.trailers USING gin (license_plate gin_trgm_ops);

COMMENT ON COLUMN app.trailers.is_external IS
    'C1.11. Driver-created placeholder for a trailer not in the master registry. Admin merges it later.';

-- vehicles.current_driver_id -> drivers.id (declared here now that both exist).
ALTER TABLE app.vehicles
    ADD CONSTRAINT vehicles_current_driver_fk
    FOREIGN KEY (current_driver_id) REFERENCES app.drivers(id) ON DELETE SET NULL;

CREATE INDEX vehicles_current_driver_idx
    ON app.vehicles (current_driver_id) WHERE current_driver_id IS NOT NULL;

-- drivers.hos_policy_id FK is added in 06_telemetry_hos.sql once hos_policies exists.

-- -----------------------------------------------------------------------------
-- app.asset_documents  (C3.10, B8, 3.5)
-- -----------------------------------------------------------------------------
-- One generic registry for vehicle, trailer AND driver documents so a single
-- expiry engine covers all three. Exactly one owner column is populated, which
-- keeps real foreign keys instead of a polymorphic owner_id.
-- -----------------------------------------------------------------------------
CREATE TABLE app.asset_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    vehicle_id          uuid REFERENCES app.vehicles(id) ON DELETE CASCADE,
    trailer_id          uuid REFERENCES app.trailers(id) ON DELETE CASCADE,
    driver_id           uuid REFERENCES app.drivers(id) ON DELETE CASCADE,

    document_type       app.document_type NOT NULL,
    document_number     text,
    issuer              text,
    issued_on           date,
    expires_on          date,

    media_object_id     uuid REFERENCES app.media_objects(id),

    -- 3.5: when true, expiry sets the owning asset's is_operational to false and
    -- blocks clock-in. Advisory documents (e.g. a training certificate) do not.
    is_blocking         boolean NOT NULL DEFAULT true,

    superseded_by_id    uuid REFERENCES app.asset_documents(id) ON DELETE SET NULL,
    uploaded_by         uuid REFERENCES app.users(id),
    notes               text,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT asset_documents_exactly_one_owner CHECK (
        (vehicle_id IS NOT NULL)::int
      + (trailer_id IS NOT NULL)::int
      + (driver_id  IS NOT NULL)::int = 1
    ),
    CONSTRAINT asset_documents_date_order
        CHECK (issued_on IS NULL OR expires_on IS NULL OR issued_on <= expires_on),
    CONSTRAINT asset_documents_no_self_supersede
        CHECK (superseded_by_id IS DISTINCT FROM id)
);

-- Only one current (non-superseded) document of each type per owner.
CREATE UNIQUE INDEX asset_documents_current_vehicle_unique
    ON app.asset_documents (vehicle_id, document_type)
    WHERE vehicle_id IS NOT NULL AND superseded_by_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX asset_documents_current_trailer_unique
    ON app.asset_documents (trailer_id, document_type)
    WHERE trailer_id IS NOT NULL AND superseded_by_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX asset_documents_current_driver_unique
    ON app.asset_documents (driver_id, document_type)
    WHERE driver_id IS NOT NULL AND superseded_by_id IS NULL AND deleted_at IS NULL;

-- Drives the daily expiry worker (B8).
CREATE INDEX asset_documents_expiry_sweep_idx
    ON app.asset_documents (expires_on)
    WHERE deleted_at IS NULL AND superseded_by_id IS NULL AND expires_on IS NOT NULL;

COMMENT ON TABLE app.asset_documents IS
    'C3.10. Vehicle, trailer and driver documents in one registry so one worker handles all expiries.';

-- -----------------------------------------------------------------------------
-- app.assignments  (B14, C4.5, 4.4)
-- -----------------------------------------------------------------------------
-- Day-by-day dispatch. C1.8 makes an assignment mandatory before clock-in.
-- trailer_id is nullable to support bobtail (C1.3) and rigids/vans (C4.1).
-- -----------------------------------------------------------------------------
CREATE TABLE app.assignments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assigned_date   date NOT NULL,
    driver_id       uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,
    vehicle_id      uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    trailer_id      uuid REFERENCES app.trailers(id) ON DELETE RESTRICT,

    status          app.assignment_status NOT NULL DEFAULT 'PLANNED',
    notes           text,

    created_by      uuid REFERENCES app.users(id),
    cancelled_by    uuid REFERENCES app.users(id),
    cancelled_at    timestamptz,
    cancel_reason   text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT assignments_cancel_complete
        CHECK ((status <> 'CANCELLED') OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

-- One live assignment per driver, per vehicle and per trailer on a given date.
CREATE UNIQUE INDEX assignments_driver_date_unique
    ON app.assignments (driver_id, assigned_date) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX assignments_vehicle_date_unique
    ON app.assignments (vehicle_id, assigned_date) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX assignments_trailer_date_unique
    ON app.assignments (trailer_id, assigned_date)
    WHERE trailer_id IS NOT NULL AND status <> 'CANCELLED';
CREATE INDEX assignments_date_idx ON app.assignments (assigned_date DESC);

COMMENT ON TABLE app.assignments IS
    'Daily dispatch (4.4/B14). assigned_date is the Kenyan operational date (A2.3).';

-- -----------------------------------------------------------------------------
-- app.recovery_modes  (N3.1)
-- -----------------------------------------------------------------------------
-- The single documented exception to the C5.6 off-shift location discard rule.
-- An Admin may re-enable location retention for one vehicle for a bounded
-- window, with a mandatory reason. Every enable and disable is audited.
-- -----------------------------------------------------------------------------
CREATE TABLE app.recovery_modes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
    reason          text NOT NULL CHECK (btrim(reason) <> ''),
    enabled_by      uuid NOT NULL REFERENCES app.users(id),
    enabled_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    disabled_by     uuid REFERENCES app.users(id),
    disabled_at     timestamptz,

    CONSTRAINT recovery_modes_window_valid CHECK (expires_at > enabled_at),
    CONSTRAINT recovery_modes_max_window CHECK (expires_at <= enabled_at + interval '30 days')
);

-- Only one active recovery window per vehicle at a time.
CREATE UNIQUE INDEX recovery_modes_active_unique
    ON app.recovery_modes (vehicle_id) WHERE disabled_at IS NULL;
CREATE INDEX recovery_modes_expiry_idx
    ON app.recovery_modes (expires_at) WHERE disabled_at IS NULL;

COMMENT ON TABLE app.recovery_modes IS
    'N3.1. Bounded, audited override of off-shift location discard, for stolen-vehicle recovery.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER geofences_set_updated_at
    BEFORE UPDATE ON app.geofences
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER geofences_no_hard_delete
    BEFORE DELETE ON app.geofences
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER vehicles_set_updated_at
    BEFORE UPDATE ON app.vehicles
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER vehicles_no_hard_delete
    BEFORE DELETE ON app.vehicles
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER trailers_set_updated_at
    BEFORE UPDATE ON app.trailers
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER trailers_no_hard_delete
    BEFORE DELETE ON app.trailers
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER asset_documents_set_updated_at
    BEFORE UPDATE ON app.asset_documents
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER asset_documents_no_hard_delete
    BEFORE DELETE ON app.asset_documents
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER assignments_set_updated_at
    BEFORE UPDATE ON app.assignments
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
