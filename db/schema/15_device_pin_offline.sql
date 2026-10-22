-- =============================================================================
-- 13_device_pin_offline.sql
-- Fleet Management Platform - Driver device PIN + offline-lock + device-bound
--                             refresh token (02-auth.md §4, B12, M4)
--
-- Phase: 2
--
-- The driver PIN is a device-local secret that never transits the wire: only
-- `pin_set_at` records that a local PIN exists. The device-bound refresh token
-- enables the offline login path; its hash lives in `refresh_token_hash` and its
-- usability is capped by `offline_window_expires_at`. Offline PIN failure
-- counters (`offline_pin_failures`, `offline_locked_until`) mirror the on-device
-- lockout policy (M4: 5 failures → 15 min lock, 10 → local wipe).
--
-- Every column is nullable / carries a DEFAULT so existing rows stay valid.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

ALTER TABLE app.driver_devices
    ADD COLUMN IF NOT EXISTS pin_set_at                  timestamptz,
    ADD COLUMN IF NOT EXISTS refresh_token_hash          varchar(255),
    ADD COLUMN IF NOT EXISTS refresh_token_expires_at    timestamptz,
    ADD COLUMN IF NOT EXISTS offline_window_expires_at   timestamptz,
    ADD COLUMN IF NOT EXISTS offline_pin_failures        integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS offline_locked_until        timestamptz;

COMMENT ON COLUMN app.driver_devices.pin_set_at IS
    'B12. Set when the device reports a local PIN exists. The PIN hash never leaves the device.';
COMMENT ON COLUMN app.driver_devices.refresh_token_hash IS
    'Hash of the device-bound refresh token enabling the offline login path (02 §4).';
COMMENT ON COLUMN app.driver_devices.refresh_token_expires_at IS
    'Expiry of the device-bound refresh token.';
COMMENT ON COLUMN app.driver_devices.offline_window_expires_at IS
    'Upper bound on offline usability of the device-bound refresh token.';
COMMENT ON COLUMN app.driver_devices.offline_pin_failures IS
    'M4 mirror of on-device PIN failure counter (5 → lock, 10 → wipe).';
COMMENT ON COLUMN app.driver_devices.offline_locked_until IS
    'M4: until this time the offline PIN is locked on the device.';
