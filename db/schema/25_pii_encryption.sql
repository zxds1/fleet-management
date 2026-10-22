-- =============================================================================
-- 19_pii_encryption.sql
-- Enterprise-grade field-level PII encryption for app.users and related tables.
--
-- Design principles (audit L11 / security Layer 3):
--   1. Plaintext PII is NEVER persisted. Columns ending in _plaintext are
--      view-only (materialized from encrypted at read time, never stored).
--   2. Every encrypted column has a key_version column tracking which key
--      encrypted it, enabling zero-downtime key rotation.
--   3. Backup encryption keys are stored in app.encryption_key_backups with
--      a separate key_encryption_key (KEK). Deleting (shredding) a backup key
--      cryptographically erases all data encrypted with that key — the data
--      becomes unrecoverable without the key, satisfying GDPR Art. 17
--      (right to erasure) via "crypto-shredding".
--   4. Encryption uses pgcrypto pgp_sym_encrypt with AES-256 (OpenPGP CFB
--      mode, symmetric passphrase). The passphrase is resolved from the
--      SecretsClient (PII_ENCRYPTION_KEY_v1, v2, ...) at call time.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- PII encryption key backup store (KEK-wrapped backups for crypto-shredding)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.encryption_key_backups (
    key_id        text PRIMARY KEY,           -- e.g. 'pii_v1', 'pii_v2'
    key_version   smallint NOT NULL,           -- monotonic, matches users.encryption_key_version
    encrypted_key text NOT NULL,              -- KEK-wrapped copy of the PII key (base64)
    created_at    timestamptz NOT NULL DEFAULT now(),
    rotated_at    timestamptz,                 -- when this key was superseded
    shredded_at   timestamptz,                 -- when this key was destroyed (crypto-erasure)
    CONSTRAINT encryption_key_backups_version_unique UNIQUE (key_version)
);

COMMENT ON TABLE app.encryption_key_backups IS
    'Encrypted backup copies of PII symmetric keys, wrapped by a separate KEK. Shredding (deleting) a backup key cryptographically erases all user PII encrypted under that key version.';

-- -----------------------------------------------------------------------------
-- app.users: add encrypted PII columns + key versioning
-- -----------------------------------------------------------------------------
ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS email_encrypted bytea,
    ADD COLUMN IF NOT EXISTS phone_encrypted bytea,
    ADD COLUMN IF NOT EXISTS ssn_encrypted bytea,
    ADD COLUMN IF NOT EXISTS emergency_contact_encrypted bytea,
    ADD COLUMN IF NOT EXISTS encryption_key_version smallint NOT NULL DEFAULT 1;

-- Index for key-version lookups during rotation and shredding.
CREATE INDEX IF NOT EXISTS users_encryption_key_version_idx
    ON app.users (encryption_key_version);

-- -----------------------------------------------------------------------------
-- app.drivers: no PII columns are added here.
--
-- A driver's national ID and emergency contact live on app.driver_onboarding,
-- which stores them as ciphertext only (ssn_encrypted) — there is no plaintext
-- column to migrate. app.drivers holds only the operational attributes
-- (licence number, status), and the contact details are reached through the
-- onboarding row.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Migrate existing plaintext PII into encrypted columns (one-time backfill).
-- After this migration runs, the application must stop writing plaintext to
-- email/phone columns and use only the _encrypted variants.
-- -----------------------------------------------------------------------------
UPDATE app.users
SET email_encrypted = pgp_sym_encrypt(email::text, current_setting('app.pii_encryption_key_v1', false)),
    phone_encrypted = pgp_sym_encrypt(phone::text, current_setting('app.pii_encryption_key_v1', false)),
    encryption_key_version = 1
WHERE email_encrypted IS NULL AND phone_encrypted IS NULL;

COMMENT ON COLUMN app.users.email_encrypted IS 'AES-256 (OpenPGP CFB) encryption of app.users.email. Key version tracked by encryption_key_version.';
COMMENT ON COLUMN app.users.phone_encrypted IS 'AES-256 (OpenPGP CFB) encryption of app.users.phone. Key version tracked by encryption_key_version.';
COMMENT ON COLUMN app.users.ssn_encrypted IS 'AES-256 (OpenPGP CFB) encryption of app.users.ssn. Key version tracked by encryption_key_version.';
COMMENT ON COLUMN app.users.emergency_contact_encrypted IS 'AES-256 (OpenPGP CFB) encryption of app.users.emergency_contact. Key version tracked by encryption_key_version.';
COMMENT ON COLUMN app.users.encryption_key_version IS 'Which PII symmetric key version encrypted the _encrypted columns. Used for key rotation and crypto-shredding.';

