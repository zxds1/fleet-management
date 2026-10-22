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

-- -----------------------------------------------------------------------------
-- Monthly partitions, provisioned idempotently (same shape as the telemetry and
-- audit tables in 10_partitions.sql).
-- The parent was previously left with no partition at all, so EVERY insert of a
-- >=400 response failed with "no partition of relation error_events found for
-- row" — the error mirror was silently dead, and the error handler itself
-- double-faulted while trying to record the original failure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_ensure_error_event_partitions(p_months_ahead integer DEFAULT 3)
RETURNS TABLE (partition_name text, created boolean)
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_month_start date;
    v_month_end   date;
    v_name        text;
    v_exists      boolean;
    i             integer;
BEGIN
    IF p_months_ahead < 0 THEN
        RAISE EXCEPTION 'p_months_ahead must be >= 0';
    END IF;

    FOR i IN -1 .. p_months_ahead LOOP
        v_month_start := date_trunc('month', (now() AT TIME ZONE 'UTC')::date + (i || ' months')::interval)::date;
        v_month_end   := (v_month_start + interval '1 month')::date;
        v_name        := format('error_events_y%sm%s',
                                to_char(v_month_start, 'YYYY'),
                                to_char(v_month_start, 'MM'));

        SELECT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND c.relname = v_name
        ) INTO v_exists;

        IF NOT v_exists THEN
            EXECUTE format(
                'CREATE TABLE app.%I PARTITION OF app.error_events '
                'FOR VALUES FROM (%L) TO (%L)',
                v_name, v_month_start, v_month_end
            );
            partition_name := v_name; created := true; RETURN NEXT;
        ELSE
            partition_name := v_name; created := false; RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION app.fn_ensure_error_event_partitions(integer) IS
    'Idempotent monthly partition provisioning for app.error_events. One month back covers late-arriving or clock-skewed writes; called nightly by the maintenance worker.';

-- Catch-all so an unexpected clock skew or a late write can never fail an insert.
-- Mirroring the telemetry/audit tables: it must stay empty, and the maintenance
-- worker alerts if it is not.
CREATE TABLE IF NOT EXISTS app.error_events_default
    PARTITION OF app.error_events DEFAULT;

SELECT * FROM app.fn_ensure_error_event_partitions(3);
