-- =============================================================================
-- 07_financial.sql
-- Fleet Management Platform - Fuel gauge records, purchases, cards, anomalies,
--                             efficiency, expenses, reconciliation, payroll
--
-- Decisions: A1.4, A1.9, B2, B3, B5, B6, C2.1-C2.10, D2, M1, M2, M3
-- Phase: 2 (schema authored now per N10; deployed with Phase 2)
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.fuel_cards  (2.3, C2.1, C2.2, C2.3)
-- -----------------------------------------------------------------------------
-- C2.1: the full PAN is never stored, hashed or otherwise. Only the last four
-- digits plus a human label. This keeps the platform out of PCI DSS scope.
--
-- C2.2: cards belong to a vehicle, but a vehicle may hold several, and a pooled
-- card may be used on any vehicle. M2 makes CARD_MISMATCH fire only for
-- non-pooled cards on the wrong vehicle, so the alert stays meaningful.
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_cards (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label                   text NOT NULL,                 -- e.g. 'Shell Card #1234'
    last_four               app.card_last_four NOT NULL,
    provider                text NOT NULL,

    is_pooled               boolean NOT NULL DEFAULT false,
    assigned_vehicle_id     uuid REFERENCES app.vehicles(id) ON DELETE SET NULL,

    credit_limit            app.money_amount,
    currency                app.currency_code,
    expires_on              date,

    status                  text NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','BLOCKED','LOST','CANCELLED')),

    notes                   text,
    created_by              uuid REFERENCES app.users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    -- A pooled card belongs to no single vehicle; a dedicated card must have one.
    CONSTRAINT fuel_cards_pooling_consistent
        CHECK ((is_pooled = true  AND assigned_vehicle_id IS NULL)
            OR (is_pooled = false AND assigned_vehicle_id IS NOT NULL))
);

CREATE UNIQUE INDEX fuel_cards_provider_lastfour_unique
    ON app.fuel_cards (provider, last_four) WHERE deleted_at IS NULL;
CREATE INDEX fuel_cards_vehicle_idx
    ON app.fuel_cards (assigned_vehicle_id) WHERE assigned_vehicle_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX fuel_cards_expiry_idx
    ON app.fuel_cards (expires_on) WHERE deleted_at IS NULL AND status = 'ACTIVE';

COMMENT ON TABLE app.fuel_cards IS
    'C2.1. Last four digits only - never a PAN. Deliberately out of PCI DSS scope.';

-- -----------------------------------------------------------------------------
-- app.fuel_records  (2.1, B1, B2, B3, M3)
-- -----------------------------------------------------------------------------
-- Every dashboard photo: shift start, shift end, before refuelling, after
-- refuelling, and driver-initiated spot checks. B3 makes the before/after pair
-- mandatory, which is what gives the anomaly engine (2.5) something to compare.
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_records (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                    uuid NOT NULL REFERENCES app.shifts(id) ON DELETE RESTRICT,
    vehicle_id                  uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    driver_id                   uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,

    purpose                     app.fuel_record_purpose NOT NULL,

    -- Mandatory dashboard photograph showing gauge and odometer.
    media_object_id             uuid NOT NULL UNIQUE REFERENCES app.media_objects(id),
    odometer_km                 app.odometer_km NOT NULL,

    -- B2: driver-selected position. No OCR of an analogue needle.
    gauge_level                 app.fuel_gauge_level NOT NULL,
    gauge_percent               numeric(5,2) GENERATED ALWAYS AS (
                                    CASE gauge_level
                                        WHEN 'EMPTY'         THEN 0
                                        WHEN 'QUARTER'       THEN 25
                                        WHEN 'HALF'          THEN 50
                                        WHEN 'THREE_QUARTER' THEN 75
                                        WHEN 'FULL'          THEN 100
                                    END
                                ) STORED,

    -- M3: advisory cross-check from OBD. Divergence raises an INFO anomaly only.
    obd_fuel_level_percent      numeric(5,2) CHECK (obd_fuel_level_percent IS NULL OR obd_fuel_level_percent BETWEEN 0 AND 100),
    obd_odometer_km             integer,

    -- B2: Admin may correct the driver's selection during verification.
    adjusted_gauge_level        app.fuel_gauge_level,
    adjusted_odometer_km        app.odometer_km,
    adjusted_by                 uuid REFERENCES app.users(id),
    adjusted_at                 timestamptz,
    adjustment_reason           text,

    captured_at                 timestamptz NOT NULL DEFAULT now(),
    client_uuid                 uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fuel_records_adjustment_complete
        CHECK (adjusted_at IS NULL OR (adjusted_by IS NOT NULL AND adjustment_reason IS NOT NULL))
);

CREATE INDEX fuel_records_shift_idx        ON app.fuel_records (shift_id, captured_at);
CREATE INDEX fuel_records_vehicle_time_idx ON app.fuel_records (vehicle_id, captured_at DESC);
-- 2.5: the anomaly engine looks for gauge photos within N minutes of a purchase.
CREATE INDEX fuel_records_refuel_window_idx
    ON app.fuel_records (vehicle_id, captured_at)
    WHERE purpose IN ('REFUEL_BEFORE','REFUEL_AFTER');
-- Exactly one start and one end gauge record per shift (B1).
CREATE UNIQUE INDEX fuel_records_one_start_per_shift
    ON app.fuel_records (shift_id) WHERE purpose = 'SHIFT_START';
CREATE UNIQUE INDEX fuel_records_one_end_per_shift
    ON app.fuel_records (shift_id) WHERE purpose = 'SHIFT_END';

COMMENT ON COLUMN app.fuel_records.gauge_percent IS
    'B2. Derived from the driver selector. Feeds the expected-gauge-rise comparison in 2.5.';

-- -----------------------------------------------------------------------------
-- app.fuel_purchases  (2.2, B3, C2.3, M2)
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_purchases (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                    uuid REFERENCES app.shifts(id) ON DELETE RESTRICT,
    vehicle_id                  uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    driver_id                   uuid REFERENCES app.drivers(id) ON DELETE RESTRICT,

    entry_source                text NOT NULL DEFAULT 'DRIVER'
                                CHECK (entry_source IN ('DRIVER','ADMIN')),

    -- C2.1: the card is identified by last four; the FK is resolved when a
    -- matching registry entry exists, and left NULL when it does not (which is
    -- itself an anomaly rather than a validation failure - C2.3).
    fuel_card_id                uuid REFERENCES app.fuel_cards(id) ON DELETE SET NULL,
    fuel_card_last_four         app.card_last_four NOT NULL,

    supplier_name               text,
    litres                      numeric(8,2) NOT NULL CHECK (litres > 0 AND litres <= 5000),
    total_cost                  app.money_amount NOT NULL,
    currency                    app.currency_code,
    unit_price                  numeric(10,4) GENERATED ALWAYS AS (round(total_cost / litres, 4)) STORED,

    odometer_km                 app.odometer_km NOT NULL,
    purchased_at                timestamptz NOT NULL,

    receipt_media_object_id     uuid NOT NULL UNIQUE REFERENCES app.media_objects(id),

    -- B3: the mandatory gauge pair. Required for driver-entered purchases; an
    -- Admin back-entry (A1.5 conflict path) may legitimately lack them, which
    -- the anomaly engine then reports as MISSING_GAUGE_EVIDENCE.
    before_fuel_record_id       uuid REFERENCES app.fuel_records(id) ON DELETE SET NULL,
    after_fuel_record_id        uuid REFERENCES app.fuel_records(id) ON DELETE SET NULL,

    -- A1.4: OCR is advisory. Driver-entered values remain authoritative until an
    -- Admin verifies or adjusts them.
    ocr_status                  app.ocr_status NOT NULL DEFAULT 'PENDING',
    ocr_litres                  numeric(8,2),
    ocr_total_cost              app.money_amount,
    ocr_confidence              numeric(4,3) CHECK (ocr_confidence IS NULL OR ocr_confidence BETWEEN 0 AND 1),
    ocr_raw                     jsonb,
    ocr_processed_at            timestamptz,

    admin_verified              boolean NOT NULL DEFAULT false,
    verified_by                 uuid REFERENCES app.users(id),
    verified_at                 timestamptz,
    adjustments                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    rejected_at                 timestamptz,
    rejected_by                 uuid REFERENCES app.users(id),
    rejection_reason            text,

    -- C6.1: the FINANCE role may clear for payment but may not adjust data.
    cleared_for_payment_at      timestamptz,
    cleared_by                  uuid REFERENCES app.users(id),

    client_uuid                 uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fuel_purchases_driver_entry_has_gauge_pair
        CHECK (entry_source <> 'DRIVER'
               OR (before_fuel_record_id IS NOT NULL AND after_fuel_record_id IS NOT NULL)),
    CONSTRAINT fuel_purchases_driver_entry_has_driver
        CHECK (entry_source <> 'DRIVER' OR (driver_id IS NOT NULL AND shift_id IS NOT NULL)),
    CONSTRAINT fuel_purchases_verified_complete
        CHECK (admin_verified = false OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
    CONSTRAINT fuel_purchases_rejection_complete
        CHECK (rejected_at IS NULL OR (rejected_by IS NOT NULL AND rejection_reason IS NOT NULL)),
    CONSTRAINT fuel_purchases_not_both_verified_and_rejected
        CHECK (NOT (admin_verified = true AND rejected_at IS NOT NULL)),
    CONSTRAINT fuel_purchases_clearance_requires_verification
        CHECK (cleared_for_payment_at IS NULL OR admin_verified = true),
    CONSTRAINT fuel_purchases_distinct_gauge_records
        CHECK (before_fuel_record_id IS DISTINCT FROM after_fuel_record_id)
);

CREATE INDEX fuel_purchases_vehicle_time_idx ON app.fuel_purchases (vehicle_id, purchased_at DESC);
CREATE INDEX fuel_purchases_shift_idx        ON app.fuel_purchases (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX fuel_purchases_card_idx         ON app.fuel_purchases (fuel_card_last_four, purchased_at DESC);
-- 2.7 Fuel Reconciliation Inbox
CREATE INDEX fuel_purchases_unverified_idx
    ON app.fuel_purchases (purchased_at DESC)
    WHERE admin_verified = false AND rejected_at IS NULL;
CREATE INDEX fuel_purchases_ocr_queue_idx
    ON app.fuel_purchases (created_at) WHERE ocr_status = 'PENDING';
-- 2.8 monthly aggregation: GROUP BY vehicle_id, date_trunc('month', purchased_at)
CREATE INDEX fuel_purchases_month_idx
    ON app.fuel_purchases (vehicle_id, (date_trunc('month', purchased_at AT TIME ZONE 'Africa/Nairobi')));

COMMENT ON CONSTRAINT fuel_purchases_driver_entry_has_gauge_pair ON app.fuel_purchases IS
    'B3. Without the before/after gauge pair the fraud engine is blind, so the database refuses driver entries that lack it.';

-- -----------------------------------------------------------------------------
-- app.fuel_purchase_anomalies  (2.5, C2.3, C2.4, M2, M3)
-- -----------------------------------------------------------------------------
-- Retains the name from the original specification. fuel_purchase_id is nullable
-- because efficiency and odometer anomalies attach to a shift or a vehicle
-- rather than to a single receipt.
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_purchase_anomalies (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_purchase_id    uuid REFERENCES app.fuel_purchases(id) ON DELETE CASCADE,
    shift_id            uuid REFERENCES app.shifts(id) ON DELETE CASCADE,
    vehicle_id          uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
    driver_id           uuid REFERENCES app.drivers(id) ON DELETE SET NULL,

    anomaly_type        app.fuel_anomaly_type NOT NULL,
    severity            app.anomaly_severity NOT NULL,

    expected_value      numeric(12,3),
    actual_value        numeric(12,3),
    deviation_percent   numeric(7,2),
    threshold_percent   numeric(7,2),      -- the configured value at detection time (C2.4)
    detail              jsonb NOT NULL DEFAULT '{}'::jsonb,

    detected_at         timestamptz NOT NULL DEFAULT now(),
    detected_by         text NOT NULL DEFAULT 'fuel-anomaly-worker',

    resolved_at         timestamptz,
    resolved_by         uuid REFERENCES app.users(id),
    resolution_action   text CHECK (resolution_action IS NULL OR resolution_action IN
                            ('CONFIRMED_FRAUD','FALSE_POSITIVE','DATA_CORRECTED','ESCALATED','NO_ACTION')),
    resolution_notes    text,

    CONSTRAINT fuel_anomalies_have_a_subject
        CHECK (fuel_purchase_id IS NOT NULL OR shift_id IS NOT NULL),
    CONSTRAINT fuel_anomalies_resolution_complete
        CHECK (resolved_at IS NULL OR (resolved_by IS NOT NULL AND resolution_action IS NOT NULL))
);

CREATE INDEX fuel_anomalies_open_idx
    ON app.fuel_purchase_anomalies (severity, detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX fuel_anomalies_purchase_idx ON app.fuel_purchase_anomalies (fuel_purchase_id);
CREATE INDEX fuel_anomalies_vehicle_idx  ON app.fuel_purchase_anomalies (vehicle_id, detected_at DESC);
-- One open anomaly of a given type per purchase; the hourly worker is idempotent.
CREATE UNIQUE INDEX fuel_anomalies_dedupe
    ON app.fuel_purchase_anomalies (fuel_purchase_id, anomaly_type)
    WHERE fuel_purchase_id IS NOT NULL AND resolved_at IS NULL;

-- -----------------------------------------------------------------------------
-- app.fuel_efficiency_records  (2.6, B5, B6)
-- -----------------------------------------------------------------------------
-- B5: FULL_TO_FULL is authoritative. Anything else is marked approximate and is
-- excluded from the rolling baseline so noise cannot poison the alerting.
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_efficiency_records (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                uuid NOT NULL UNIQUE REFERENCES app.shifts(id) ON DELETE CASCADE,
    vehicle_id              uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,

    distance_km             numeric(10,2) NOT NULL CHECK (distance_km > 0),
    litres_consumed         numeric(9,2) NOT NULL CHECK (litres_consumed >= 0),
    method                  app.consumption_method NOT NULL,
    is_approximate          boolean NOT NULL,

    l_per_100km             numeric(7,2) GENERATED ALWAYS AS
                            (round((litres_consumed / distance_km) * 100, 2)) STORED,

    baseline_l_per_100km    numeric(6,2),
    baseline_scope          text CHECK (baseline_scope IS NULL OR baseline_scope IN ('VEHICLE','FLEET')),
    deviation_percent       numeric(7,2),

    fuel_cost               app.money_amount,
    currency                app.currency_code,
    cost_per_km             numeric(10,4),

    computed_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fuel_efficiency_method_matches_flag
        CHECK (is_approximate = (method = 'GAUGE_ESTIMATE'))
);

CREATE INDEX fuel_efficiency_vehicle_idx ON app.fuel_efficiency_records (vehicle_id, computed_at DESC);
-- B6: the rolling baseline is computed from exact records only.
CREATE INDEX fuel_efficiency_baseline_source_idx
    ON app.fuel_efficiency_records (vehicle_id, computed_at DESC) WHERE is_approximate = false;

COMMENT ON CONSTRAINT fuel_efficiency_method_matches_flag ON app.fuel_efficiency_records IS
    'B5. GAUGE_ESTIMATE is always flagged approximate and never contributes to the baseline.';

-- -----------------------------------------------------------------------------
-- app.expenses  (2.4, C2.6, C2.7)
-- -----------------------------------------------------------------------------
CREATE TABLE app.expenses (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id                uuid REFERENCES app.shifts(id) ON DELETE RESTRICT,
    vehicle_id              uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE RESTRICT,
    driver_id               uuid NOT NULL REFERENCES app.drivers(id) ON DELETE RESTRICT,

    category                app.expense_category NOT NULL,
    amount                  app.money_amount NOT NULL CHECK (amount > 0),
    currency                app.currency_code,
    incurred_at             timestamptz NOT NULL,
    supplier_name           text,
    notes                   text,

    receipt_media_object_id uuid NOT NULL UNIQUE REFERENCES app.media_objects(id),

    approval_status         app.approval_status NOT NULL DEFAULT 'PENDING',
    approved_by             uuid REFERENCES app.users(id),
    approved_at             timestamptz,
    rejection_reason        text,

    -- C2.7: automatic Admin alert above the configured threshold (default KES 5 000).
    high_value_alert_sent_at timestamptz,

    client_uuid             uuid,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT expenses_approval_complete
        CHECK (approval_status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
    CONSTRAINT expenses_rejection_complete
        CHECK (approval_status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND approved_by IS NOT NULL))
);

CREATE INDEX expenses_pending_idx  ON app.expenses (incurred_at DESC) WHERE approval_status = 'PENDING';
CREATE INDEX expenses_vehicle_idx  ON app.expenses (vehicle_id, incurred_at DESC);
CREATE INDEX expenses_driver_idx   ON app.expenses (driver_id, incurred_at DESC);
CREATE INDEX expenses_shift_idx    ON app.expenses (shift_id) WHERE shift_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- app.fuel_card_statements / app.fuel_card_statement_lines  (A1.9)
-- -----------------------------------------------------------------------------
-- Phase 1 reconciliation is a CSV upload with a generic column mapping. Matching
-- key is date + amount + card last four.
-- -----------------------------------------------------------------------------
CREATE TABLE app.fuel_card_statements (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider            text NOT NULL,
    period_start        date NOT NULL,
    period_end          date NOT NULL,
    media_object_id     uuid NOT NULL REFERENCES app.media_objects(id),
    column_mapping      jsonb NOT NULL,
    row_count           integer NOT NULL DEFAULT 0,
    matched_count       integer NOT NULL DEFAULT 0,
    unmatched_count     integer NOT NULL DEFAULT 0,
    uploaded_by         uuid NOT NULL REFERENCES app.users(id),
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    processed_at        timestamptz,

    CONSTRAINT fuel_card_statements_period_order CHECK (period_end >= period_start)
);

CREATE TABLE app.fuel_card_statement_lines (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id            uuid NOT NULL REFERENCES app.fuel_card_statements(id) ON DELETE CASCADE,
    line_number             integer NOT NULL,

    transaction_at          timestamptz NOT NULL,
    card_last_four          app.card_last_four NOT NULL,
    amount                  app.money_amount NOT NULL,
    currency                app.currency_code,
    litres                  numeric(8,2),
    station_name            text,
    raw_row                 jsonb NOT NULL,

    match_status            app.reconciliation_match_status NOT NULL DEFAULT 'UNMATCHED',
    matched_purchase_id     uuid REFERENCES app.fuel_purchases(id) ON DELETE SET NULL,
    matched_by              uuid REFERENCES app.users(id),
    matched_at              timestamptz,
    match_notes             text,

    UNIQUE (statement_id, line_number),
    CONSTRAINT statement_lines_match_complete
        CHECK (match_status NOT IN ('MATCHED','MANUALLY_MATCHED') OR matched_purchase_id IS NOT NULL)
);

CREATE INDEX statement_lines_unmatched_idx
    ON app.fuel_card_statement_lines (transaction_at DESC) WHERE match_status = 'UNMATCHED';
CREATE INDEX statement_lines_match_key_idx
    ON app.fuel_card_statement_lines (card_last_four, transaction_at, amount);
CREATE UNIQUE INDEX statement_lines_one_match_per_purchase
    ON app.fuel_card_statement_lines (matched_purchase_id)
    WHERE matched_purchase_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- app.payroll_exports  (C2.5)
-- -----------------------------------------------------------------------------
-- Phase 1 is export only. The checksum makes it possible to prove which file
-- Finance actually received.
-- -----------------------------------------------------------------------------
CREATE TABLE app.payroll_exports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start        date NOT NULL,
    period_end          date NOT NULL,
    media_object_id     uuid REFERENCES app.media_objects(id),
    row_count           integer NOT NULL DEFAULT 0,
    included_shift_ids  uuid[] NOT NULL DEFAULT '{}',
    sha256              bytea,
    generated_by        uuid NOT NULL REFERENCES app.users(id),
    generated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT payroll_exports_period_order CHECK (period_end >= period_start)
);

CREATE INDEX payroll_exports_period_idx ON app.payroll_exports (period_start DESC);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER fuel_cards_set_updated_at
    BEFORE UPDATE ON app.fuel_cards
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER fuel_cards_no_hard_delete
    BEFORE DELETE ON app.fuel_cards
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER fuel_purchases_set_updated_at
    BEFORE UPDATE ON app.fuel_purchases
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER fuel_purchases_no_hard_delete
    BEFORE DELETE ON app.fuel_purchases
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER fuel_records_no_hard_delete
    BEFORE DELETE ON app.fuel_records
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();

CREATE TRIGGER expenses_set_updated_at
    BEFORE UPDATE ON app.expenses
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();
CREATE TRIGGER expenses_no_hard_delete
    BEFORE DELETE ON app.expenses
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();
