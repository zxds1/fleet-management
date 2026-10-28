-- Drop plaintext PII columns after all reads/writes use encrypted variants.
-- Safe to run only once app.users.email_encrypted / phone_encrypted are fully
-- populated (verified by the backfill migration 26).
ALTER TABLE app.users DROP COLUMN IF EXISTS email;
ALTER TABLE app.users DROP COLUMN IF EXISTS phone;
