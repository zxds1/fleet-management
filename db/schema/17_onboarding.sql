-- =============================================================================
-- 13_onboarding.sql
-- Fleet Management Platform - Driver onboarding + background check
--
-- Purpose: the driver-facing onboarding workflow that precedes the first shift —
-- profile capture, licence details, emergency contact, address history, and the
-- background-check submission/clearance lifecycle (§8.1 flagged this domain as
-- having no schema at all).
--
-- Referenced decisions: A3.7 (driver lifecycle), C5.5 (consent ledger), D3 (soft
-- delete), N10 (all phases modelled now, additive migrations only).
-- Phase: 3
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- app.background_check_status
-- -----------------------------------------------------------------------------
-- Closed lifecycle for the screening result. NOT_SUBMITTED is the initial state
-- of an auto-created onboarding row; FLAGGED and EXPIRED both block the driver
-- until a FLEET_MANAGER re-clears them.
-- -----------------------------------------------------------------------------
CREATE TYPE app.background_check_status AS ENUM (
    'NOT_SUBMITTED',
    'SUBMITTED',
    'CLEARED',
    'FLAGGED',
    'EXPIRED'
);

-- -----------------------------------------------------------------------------
-- app.driver_onboarding
-- -----------------------------------------------------------------------------
-- One live row per driver (enforced by the partial unique index below). The
-- driver app reads/writes its own row; FLEET_MANAGER/ADMIN review and clear the
-- background check.
--
-- ssn_encrypted holds the ciphertext only — the plaintext national ID / SSN is
-- never stored, mirroring the treatment of users.mfa_secret_encrypted.
-- -----------------------------------------------------------------------------
CREATE TABLE app.driver_onboarding (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id                       uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,

    -- Profile step
    full_name                       text,
    licence_number                  text,
    licence_class                   text,
    emergency_contact_name          text,
    emergency_contact_phone         text,
    address_json                    jsonb,

    -- Background-check step (sensitive)
    ssn_encrypted                   text,
    dob                             date,
    previous_addresses_json         jsonb,

    background_check_status         app.background_check_status NOT NULL DEFAULT 'NOT_SUBMITTED',
    background_check_submitted_at   timestamptz,
    background_check_cleared_at     timestamptz,

    -- Screening consent (C5.5-style ledger entry, scoped to this record)
    consent_given                   boolean NOT NULL DEFAULT false,
    consent_at                      timestamptz,

    -- Set once dispatch allocates the driver their first vehicle.
    assigned_vehicle_id             uuid REFERENCES app.vehicles(id) ON DELETE SET NULL,

    onboarding_complete             boolean NOT NULL DEFAULT false,

    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),
    deleted_at                      timestamptz
);

-- One live onboarding record per driver (D3 soft delete).
CREATE UNIQUE INDEX driver_onboarding_driver_unique
    ON app.driver_onboarding (driver_id) WHERE deleted_at IS NULL;

CREATE INDEX driver_onboarding_status_idx
    ON app.driver_onboarding (background_check_status) WHERE deleted_at IS NULL;

COMMENT ON TABLE app.driver_onboarding IS
    'Driver onboarding workflow + background-check lifecycle. One live row per driver.';
COMMENT ON COLUMN app.driver_onboarding.ssn_encrypted IS
    'Ciphertext of the national ID / SSN. The plaintext is never stored and is never returned by the API.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER driver_onboarding_set_updated_at
    BEFORE UPDATE ON app.driver_onboarding
    FOR EACH ROW EXECUTE FUNCTION app.fn_set_updated_at();

CREATE TRIGGER driver_onboarding_no_hard_delete
    BEFORE DELETE ON app.driver_onboarding
    FOR EACH ROW EXECUTE FUNCTION app.fn_reject_hard_delete();
