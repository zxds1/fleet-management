-- =============================================================================
-- 12_fuel_hardware_extension.sql
-- Fleet Management Platform - Photo-first fuel capture and tracker
--                             (hardware) provisioning extension
--
-- Decisions: A1.1, A1.4, B3, C2.3, C2.4, M2, N2.3
-- Phase: 2
--
-- This file EXTENDS the tables created in 04_assets.sql and 07_financial.sql.
-- It adds no new tables: photo-first refuelling reuses app.fuel_purchases and
-- app.fuel_purchase_anomalies, and tracker provisioning reuses app.vehicles.
-- Every column is nullable (or carries a DEFAULT) so that existing rows and
-- the existing CHECK constraints in 04/07 remain valid.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.fuel_purchases - photo-first capture (A1.4)
-- -----------------------------------------------------------------------------
-- The driver submits two photographs (receipt + odometer) and an odometer
-- reading; every monetary/volume field below is populated by OCR and may be
-- corrected by the driver or adjusted by an Admin. The legacy authoritative
-- columns (litres, total_cost, odometer_km) are untouched: they remain the
-- verified values, while the columns added here carry the as-captured
-- OCR/driver values until an Admin verifies the purchase.
-- -----------------------------------------------------------------------------
ALTER TABLE app.fuel_purchases
    ADD COLUMN IF NOT EXISTS odometer_photo_media_object_id  uuid REFERENCES app.media_objects(id),
    ADD COLUMN IF NOT EXISTS receipt_date                    date,
    ADD COLUMN IF NOT EXISTS station_name                    varchar(255),
    ADD COLUMN IF NOT EXISTS amount_spent                    numeric(14,2),
    ADD COLUMN IF NOT EXISTS liters_pumped                   numeric(10,2),
    ADD COLUMN IF NOT EXISTS price_per_liter                 numeric(10,2),
    ADD COLUMN IF NOT EXISTS ocr_method                      varchar(20),
    ADD COLUMN IF NOT EXISTS driver_corrected                boolean NOT NULL DEFAULT false;

ALTER TABLE app.fuel_purchases
    DROP CONSTRAINT IF EXISTS fuel_purchases_ocr_method_valid;
-- NOT VALID: adding a validating CHECK takes ACCESS EXCLUSIVE and full-scans the
-- table. The separate VALIDATE below only needs SHARE UPDATE EXCLUSIVE.
ALTER TABLE app.fuel_purchases
    ADD CONSTRAINT fuel_purchases_ocr_method_valid
        CHECK (ocr_method IS NULL OR ocr_method IN ('GOOGLE_VISION','MANUAL','TESSERACT'))
        NOT VALID;
ALTER TABLE app.fuel_purchases
    VALIDATE CONSTRAINT fuel_purchases_ocr_method_valid;

-- -----------------------------------------------------------------------------
-- Photo-first rows are born without litres/total_cost (A1.4)
-- -----------------------------------------------------------------------------
-- 07_financial.sql declares `litres NOT NULL CHECK (litres > 0 AND litres <= 5000)`
-- and `unit_price GENERATED ALWAYS AS (round(total_cost / litres, 4))`. A
-- photo-first submission has neither value until the OCR worker (or an Admin)
-- fills them in, so it must insert 0 — which violates that CHECK and divides by
-- zero in the generated column. Widen the bound to allow the pre-OCR zero and
-- make the derivation null-safe; the `> 0` guarantee is re-asserted at
-- verification time, where the value actually becomes authoritative.
ALTER TABLE app.fuel_purchases
    DROP CONSTRAINT IF EXISTS fuel_purchases_litres_check;
ALTER TABLE app.fuel_purchases
    ADD CONSTRAINT fuel_purchases_litres_check
        CHECK (litres >= 0 AND litres <= 5000)
        NOT VALID;
ALTER TABLE app.fuel_purchases
    VALIDATE CONSTRAINT fuel_purchases_litres_check;

-- Regenerate unit_price over NULLIF(litres,0) so a zero-litre photo-first row
-- yields NULL rather than a division-by-zero error. The column drop uses CASCADE
-- because app.v_fuel_reconciliation_inbox (11_views.sql) references it; the view is
-- recreated below, identically, so the column swap does not break the migration.
ALTER TABLE app.fuel_purchases DROP COLUMN IF EXISTS unit_price CASCADE;
ALTER TABLE app.fuel_purchases
    ADD COLUMN unit_price numeric(10,4)
        GENERATED ALWAYS AS (round(total_cost / NULLIF(litres, 0), 4)) STORED;

-- Recreate the inbox view DROPPED by the CASCADE above. Projection matches
-- 11_views.sql exactly; only the unit_price implementation changed underneath it.
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
-- New entry_source: DRIVER_PHOTO (A1.4)
-- -----------------------------------------------------------------------------
-- A photo-first submission is driver-originated but legitimately has no
-- before/after gauge pair (the gauge photos are superseded by the receipt +
-- odometer pair). Recording it as 'ADMIN' to dodge
-- fuel_purchases_driver_entry_has_gauge_pair would misrepresent provenance and
-- let it inherit the trust the back-entry branch carries. Give it its own
-- source instead, keep the driver/shift attribution requirement, and exempt
-- only the gauge pair.
ALTER TABLE app.fuel_purchases
    DROP CONSTRAINT IF EXISTS fuel_purchases_entry_source_check;
ALTER TABLE app.fuel_purchases
    ADD CONSTRAINT fuel_purchases_entry_source_check
        CHECK (entry_source IN ('DRIVER','ADMIN','DRIVER_PHOTO'))
        NOT VALID;
ALTER TABLE app.fuel_purchases
    VALIDATE CONSTRAINT fuel_purchases_entry_source_check;

-- DRIVER_PHOTO carries the receipt + odometer photo pair in place of the gauges.
ALTER TABLE app.fuel_purchases
    DROP CONSTRAINT IF EXISTS fuel_purchases_photo_entry_has_photos;
ALTER TABLE app.fuel_purchases
    ADD CONSTRAINT fuel_purchases_photo_entry_has_photos
        CHECK (entry_source <> 'DRIVER_PHOTO'
               OR (receipt_media_object_id IS NOT NULL
                   AND odometer_photo_media_object_id IS NOT NULL
                   AND driver_id IS NOT NULL))
        NOT VALID;
ALTER TABLE app.fuel_purchases
    VALIDATE CONSTRAINT fuel_purchases_photo_entry_has_photos;

COMMENT ON CONSTRAINT fuel_purchases_photo_entry_has_photos ON app.fuel_purchases IS
    'A1.4. A photo-first entry substitutes the receipt + odometer photographs for the B3 gauge pair, so both must be present and attributed to a driver.';

-- Photo-first submissions are found by the OCR worker through the receipt photo
-- and are surfaced in the pending inbox (2.7) while unverified.
CREATE INDEX IF NOT EXISTS fuel_purchases_odometer_photo_idx
    ON app.fuel_purchases (odometer_photo_media_object_id)
    WHERE odometer_photo_media_object_id IS NOT NULL;

COMMENT ON COLUMN app.fuel_purchases.odometer_photo_media_object_id IS
    'A1.4 photo-first capture. Odometer photograph submitted alongside the receipt; OCR reads the reading from it.';
COMMENT ON COLUMN app.fuel_purchases.receipt_date IS
    'Date printed on the receipt as read by OCR or corrected by the driver. purchased_at remains the evidential server-side timestamp (C5.2).';
COMMENT ON COLUMN app.fuel_purchases.station_name IS
    'Station as printed on the receipt. supplier_name remains the reconciled/normalised name (C2.10).';
COMMENT ON COLUMN app.fuel_purchases.amount_spent IS
    'OCR/driver-captured amount. total_cost remains authoritative once an Admin verifies (A1.4).';
COMMENT ON COLUMN app.fuel_purchases.liters_pumped IS
    'OCR/driver-captured volume. litres remains authoritative once an Admin verifies (A1.4).';
COMMENT ON COLUMN app.fuel_purchases.price_per_liter IS
    'OCR-captured unit price as printed. The generated unit_price column remains the derived, trusted figure.';
COMMENT ON COLUMN app.fuel_purchases.ocr_method IS
    'Which extractor produced the ocr_* values: GOOGLE_VISION, TESSERACT, or MANUAL when a human keyed them.';
COMMENT ON COLUMN app.fuel_purchases.driver_corrected IS
    'True when the driver overrode an OCR value before submission. Drives the REVIEW badge in the pending inbox (2.7).';

-- -----------------------------------------------------------------------------
-- Deprecation notice: app.fuel_records (dashboard gauge photos, 2.1 / B2)
-- -----------------------------------------------------------------------------
COMMENT ON TABLE app.fuel_records IS
    'DEPRECATED. The dashboard gauge-photo table (2.1, B2) is superseded by photo-first '
    'fuel capture on app.fuel_purchases (receipt_media_object_id + odometer_photo_media_object_id). '
    'Retained read-only for historical rows, the before/after gauge FKs, and the existing '
    'fuel_purchases_driver_entry_has_gauge_pair constraint. Do not add new columns or new writers.';

-- -----------------------------------------------------------------------------
-- app.vehicles - tracker provisioning (A1.1, N2.3)
-- -----------------------------------------------------------------------------
-- tracker_imei / traccar_device_id / has_gps_tracker already exist in
-- 04_assets.sql. These columns record how and when the physical device was
-- paired, and when it last reported, so the provisioning inbox can show
-- PENDING / ONLINE / OFFLINE / LOST without joining telemetry.
-- -----------------------------------------------------------------------------
ALTER TABLE app.vehicles
    ADD COLUMN IF NOT EXISTS tracker_brand        varchar(40),
    ADD COLUMN IF NOT EXISTS tracker_sim_number   varchar(20),
    ADD COLUMN IF NOT EXISTS tracker_paired_at    timestamptz,
    ADD COLUMN IF NOT EXISTS tracker_last_ping_at timestamptz;

CREATE INDEX IF NOT EXISTS vehicles_tracker_pending_idx
    ON app.vehicles (tracker_paired_at DESC)
    WHERE tracker_imei IS NOT NULL AND tracker_last_ping_at IS NULL AND deleted_at IS NULL;

COMMENT ON COLUMN app.vehicles.tracker_brand IS
    'Tracker manufacturer/protocol family (TELTONIKA, JIMI_CONCOX, GENERIC_H02, ...). Selects the SMS configuration command set.';
COMMENT ON COLUMN app.vehicles.tracker_sim_number IS
    'MSISDN of the SIM inside the tracker. Used to send the H02/GT06 server-configuration SMS during pairing.';
COMMENT ON COLUMN app.vehicles.tracker_paired_at IS
    'When an Admin paired this IMEI to the vehicle. NULL plus a set tracker_imei means PENDING first contact.';
COMMENT ON COLUMN app.vehicles.tracker_last_ping_at IS
    'Last position accepted from this device (mirrors app.location_updates.recorded_at). Drives ONLINE/OFFLINE/LOST (N5).';

-- -----------------------------------------------------------------------------
-- Runtime configuration for the Traccar listener (C2.4)
-- -----------------------------------------------------------------------------
-- app.system_config.key is constrained to lowercase dotted keys
-- (^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$), so the logical keys
-- TRACCAR_PUBLIC_IP / TRACCAR_H02_PORT / TRACCAR_WEBHOOK_SECRET are stored in
-- that namespace form. value is jsonb; value_type 'string' means the payload is
-- a JSON string literal.
-- -----------------------------------------------------------------------------
INSERT INTO app.system_config (key, value, value_type, description, unit, is_sensitive, phase) VALUES
    ('traccar.public_ip',       '"127.0.0.1"', 'string',  'Public IP or hostname the trackers are told to report to in the pairing SMS (A1.1).', NULL, false, 2),
    ('traccar.h02_port',        '"5013"',      'string',  'TCP port of the Traccar H02/GT06 protocol listener used in the pairing SMS.',        NULL, false, 2),
    ('traccar.webhook_secret',  '""',          'string',  'Shared secret required on /telemetry/webhook. Empty disables verification (N2.3).',  NULL, true,  2)
ON CONFLICT (key) DO NOTHING;
