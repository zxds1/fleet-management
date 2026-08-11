-- =============================================================================
-- 13_error_events.sql
-- Fleet Management Platform - Error <-> flow correlation store (audit #6)
--
-- Every >=400 RFC7807 response that carries an error_code is mirrored here so a
-- single error ("1 issue") can be correlated across request_id, route, tenant
-- and flow_step, and aggregated by fingerprint. Append-only; no UPDATE/DELETE.
--
-- Decisions: A1.8-style append-only pattern; tenant-scoped rows (14_tenancy.sql)
-- so a tenant can only see their own error events. geography is nullable for
-- flows that do not carry a locale/region.
-- =============================================================================

SET search_path = app, telemetry, audit, public;

CREATE SEQUENCE app.error_events_id_seq AS bigint;

CREATE TABLE app.error_events (
    id                  bigint NOT NULL DEFAULT nextval('app.error_events_id_seq'),
    request_id          uuid,
    error_code          text NOT NULL,
    flow_step           text,
    route               text,
    tenant_id           text,
    geography           text,
    severity            text NOT NULL DEFAULT 'error',
    message             text,
    fingerprint         text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

ALTER SEQUENCE app.error_events_id_seq OWNED BY app.error_events.id;

CREATE INDEX error_events_request_idx  ON app.error_events (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX error_events_tenant_idx   ON app.error_events (tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX error_events_code_idx     ON app.error_events (error_code, created_at DESC);
CREATE INDEX error_events_fp_idx       ON app.error_events (fingerprint, created_at DESC);

COMMENT ON TABLE app.error_events IS
    'Audit #6. Append-only error<->flow correlation store. Fingerprint aggregates identical (error_code|route|severity) events.';
COMMENT ON COLUMN app.error_events.fingerprint IS
    'error_code|route|severity — identical events share a fingerprint for "1 issue + count N" reporting (audit #7).';
COMMENT ON COLUMN app.error_events.geography IS
    'Nullable region/locale for geo-correlated errors; flows without a locale leave this NULL.';
