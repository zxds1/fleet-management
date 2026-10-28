-- Backfill encrypted PII columns using a default dev key when the runtime GUC is unset.
-- Production must override PII_ENCRYPTION_KEY and re-run with the real key.
DO $$
DECLARE k text;
BEGIN
  k := COALESCE(current_setting('app.pii_encryption_key_v1', true), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  IF k IS NULL OR k = '' THEN
    k := 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  END IF;
  UPDATE app.users
  SET email_encrypted = COALESCE(email_encrypted, pgp_sym_encrypt(email::text, k)),
      phone_encrypted = COALESCE(phone_encrypted, pgp_sym_encrypt(phone::text, k)),
      encryption_key_version = COALESCE(encryption_key_version, 1)
  WHERE email IS NOT NULL OR phone IS NOT NULL;
END $$;
