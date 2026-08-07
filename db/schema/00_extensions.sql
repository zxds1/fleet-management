-- =============================================================================
-- 00_extensions.sql
-- Fleet Management Platform - Extensions, schemas and shared helper functions
--
-- Target: PostgreSQL 16 + PostGIS 3.4 (AWS RDS, region af-south-1)
-- Decisions: A1.10, C5.9, D1, D2, D6
--
-- Run order:
--   schema/00_extensions.sql        extensions, schemas, domains, helpers
--   schema/01_enums.sql             enumerated types
--   schema/02_identity.sql          users, roles, devices, drivers, consent
--   schema/03_platform_core.sql     media registry, config, idempotency, outbox
--   schema/04_assets.sql            geofences, vehicles, trailers, documents, dispatch
--   schema/05_operations.sql        shifts, work logs, DVIR, trailer hook/drop
--   schema/06_telemetry_hos.sql     location data, tracker health, duty ledger
--   schema/07_financial.sql         fuel, cards, anomalies, expenses, payroll
--   schema/08_safety.sql            accidents, evidence chain, quarantine, maintenance
--   schema/09_audit_notifications.sql audit trail, notifications, escalation
--   schema/10_partitions.sql        partition provisioning and retention
--   schema/11_views.sql             read models for map, inboxes and reports
--   seed/01_seed.sql                reference data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- postgis      : geofence polygons (C3.7), spatial queries (ST_Within)
-- pgcrypto     : gen_random_uuid(), digest() for the accident hash chain (C3.4)
-- btree_gist   : required for the duty-segment non-overlap EXCLUDE constraint (N7)
-- citext       : case-insensitive email addresses
-- pg_trgm      : fuzzy search on plates / driver names in admin grids
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------
-- app       : all business tables
-- telemetry : high-volume partitioned GPS data, isolated for retention ops (D6)
-- audit     : append-only audit trail, isolated so it can carry its own grants (C6.5)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA app       IS 'Business domain tables.';
COMMENT ON SCHEMA telemetry IS 'High-volume partitioned telemetry. Subject to the 90-day raw retention policy (C5.3/D6).';
COMMENT ON SCHEMA audit     IS 'Append-only audit trail. UPDATE and DELETE are rejected by trigger (C6.5).';

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- Shared domains
-- -----------------------------------------------------------------------------

-- D2: money is always numeric(14,2) plus an explicit ISO-4217 currency code.
CREATE DOMAIN app.money_amount AS numeric(14, 2)
    CHECK (VALUE >= 0);

CREATE DOMAIN app.currency_code AS char(3)
    DEFAULT 'KES'
    NOT NULL
    CHECK (VALUE ~ '^[A-Z]{3}$');

-- A1.8: Africa's Talking requires E.164. Normalisation happens in the API layer;
-- the database enforces the shape.
CREATE DOMAIN app.phone_e164 AS text
    CHECK (VALUE ~ '^\+[1-9][0-9]{7,14}$');

-- Kenyan plates are validated in the application layer (formats change);
-- the database only enforces a non-empty, upper-cased, trimmed value.
CREATE DOMAIN app.license_plate AS text
    CHECK (VALUE = upper(btrim(VALUE)) AND length(VALUE) BETWEEN 3 AND 16);

-- C2.1: only ever the last four digits of a fuel card. Never a PAN.
CREATE DOMAIN app.card_last_four AS char(4)
    CHECK (VALUE ~ '^[0-9]{4}$');

-- Odometer readings in whole kilometres. C4.2 rejects decreases in triggers.
CREATE DOMAIN app.odometer_km AS integer
    CHECK (VALUE >= 0 AND VALUE <= 9999999);

-- -----------------------------------------------------------------------------
-- Shared helper functions
-- -----------------------------------------------------------------------------

-- Maintains updated_at on every row that carries the column.
CREATE OR REPLACE FUNCTION app.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.fn_set_updated_at() IS
    'BEFORE UPDATE trigger. Stamps updated_at with now() (UTC, per D1).';

-- D3: hard deletes are disabled on master records. Any DELETE is rejected;
-- callers must set deleted_at instead.
CREATE OR REPLACE FUNCTION app.fn_reject_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION
        'Hard delete is disabled on %.% (decision D3). Set deleted_at instead.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION app.fn_reject_hard_delete() IS
    'BEFORE DELETE trigger for soft-delete master tables (D3).';

-- Rejects any UPDATE or DELETE. Used by the audit trail (C6.5) and by the
-- accident evidence tables (C3.4), which must be tamper-evident.
CREATE OR REPLACE FUNCTION app.fn_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION
        '%.% is append-only. % is not permitted.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION app.fn_reject_mutation() IS
    'BEFORE UPDATE OR DELETE trigger enforcing append-only tables (C6.5, C3.4).';

-- A2.3: the operational day boundary is local EAT midnight, stored in UTC.
-- Reports, HOS daily windows and dispatch dates all use this.
CREATE OR REPLACE FUNCTION app.fn_operational_date(p_ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (p_ts AT TIME ZONE 'Africa/Nairobi')::date;
$$;

COMMENT ON FUNCTION app.fn_operational_date(timestamptz) IS
    'Converts a UTC instant to the Kenyan operational date (A2.3).';

-- Reads a typed value out of system_config. Defined here so later files can
-- reference it; app.system_config itself is created in 08_platform.sql.
CREATE OR REPLACE FUNCTION app.fn_config_numeric(p_key text, p_default numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_value numeric;
BEGIN
    SELECT (value #>> '{}')::numeric
      INTO v_value
      FROM app.system_config
     WHERE key = p_key;

    RETURN COALESCE(v_value, p_default);
EXCEPTION
    WHEN undefined_table OR invalid_text_representation THEN
        RETURN p_default;
END;
$$;

COMMENT ON FUNCTION app.fn_config_numeric(text, numeric) IS
    'Runtime-configurable threshold lookup (C2.4). Falls back to the supplied default.';
