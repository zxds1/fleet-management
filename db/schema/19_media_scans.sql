-- =============================================================================
-- 15_media_scans.sql
-- Fleet Management Platform - Malware scan table for quarantined media (S-2)
--
-- Decisions: S-2 (malware scan on PUT)
-- =============================================================================
-- app.media_scans  — one row per AV scan performed on a media object.
-- The media_objects row starts as `quarantine` and only flips to `clean` or
-- `quarantined_virus` after a scan is recorded here. While the status is not
-- CLEAN, presignGet() refuses to mint a readable URL (see security.md S-2).
-- -----------------------------------------------------------------------------

SET search_path = app, telemetry, audit, public;

CREATE TABLE app.media_scans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    media_object_id uuid NOT NULL REFERENCES app.media_objects(id) ON DELETE CASCADE,
    status          app.media_scan_status NOT NULL,
    scan_result     text,
    scanner_version text,
    scanned_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_scans_object_idx ON app.media_scans (media_object_id, scanned_at DESC);
