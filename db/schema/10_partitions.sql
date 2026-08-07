-- =============================================================================
-- 10_partitions.sql
-- Fleet Management Platform - Partition provisioning and retention automation
--
-- Decisions: A2.4, C5.3, C6.5, D6, 7.3
--
-- telemetry.location_updates : monthly range partitions, 90-day raw retention,
--                              5-minute aggregation before the partition is
--                              dropped (7.3).
-- audit.audit_logs           : yearly range partitions, 7-year retention (C6.5).
-- =============================================================================

SET search_path = app, telemetry, audit, public;

-- -----------------------------------------------------------------------------
-- telemetry.fn_ensure_location_partitions
-- -----------------------------------------------------------------------------
-- Creates monthly partitions from the current month forward. Idempotent, so the
-- nightly maintenance job can simply call it with a fixed look-ahead.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION telemetry.fn_ensure_location_partitions(p_months_ahead integer DEFAULT 3)
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

    FOR i IN 0..p_months_ahead LOOP
        v_month_start := date_trunc('month', (now() AT TIME ZONE 'UTC')::date + (i || ' months')::interval)::date;
        v_month_end   := (v_month_start + interval '1 month')::date;
        v_name        := format('location_updates_y%sm%s',
                                to_char(v_month_start, 'YYYY'),
                                to_char(v_month_start, 'MM'));

        SELECT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'telemetry' AND c.relname = v_name
        ) INTO v_exists;

        IF NOT v_exists THEN
            EXECUTE format(
                'CREATE TABLE telemetry.%I PARTITION OF telemetry.location_updates '
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

COMMENT ON FUNCTION telemetry.fn_ensure_location_partitions(integer) IS
    'D6. Idempotent monthly partition provisioning. Called nightly by the maintenance worker.';

-- A catch-all so an unexpected clock skew or a late-arriving position can never
-- fail an insert. It must stay empty; the maintenance worker alerts if it is not.
CREATE TABLE IF NOT EXISTS telemetry.location_updates_default
    PARTITION OF telemetry.location_updates DEFAULT;

COMMENT ON TABLE telemetry.location_updates_default IS
    'Safety net for out-of-range timestamps. Expected to remain empty; a non-zero count is an alert condition.';

-- Provision the current month plus three ahead.
SELECT * FROM telemetry.fn_ensure_location_partitions(3);

-- -----------------------------------------------------------------------------
-- telemetry.fn_summarise_location_month  (7.3)
-- -----------------------------------------------------------------------------
-- Rolls raw positions into 5-minute buckets so that route history survives the
-- 90-day raw cut. Runs before the partition is dropped, and is idempotent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION telemetry.fn_summarise_location_month(p_month_start date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_month_end date := (p_month_start + interval '1 month')::date;
    v_rows      integer;
BEGIN
    WITH ordered AS (
        SELECT
            lu.vehicle_id,
            lu.shift_id,
            lu.recorded_at,
            lu.position,
            lu.speed_kph,
            lu.ignition,
            date_bin('5 minutes'::interval, lu.recorded_at, TIMESTAMPTZ '2000-01-01') AS bucket_start,
            lag(lu.position)    OVER w AS prev_position,
            lag(lu.recorded_at) OVER w AS prev_recorded_at
        FROM telemetry.location_updates lu
        WHERE lu.recorded_at >= p_month_start
          AND lu.recorded_at <  v_month_end
          AND lu.is_valid_fix = true
        WINDOW w AS (PARTITION BY lu.vehicle_id ORDER BY lu.recorded_at)
    ),
    stepped AS (
        SELECT
            o.*,
            CASE
                WHEN o.prev_position IS NULL THEN 0
                ELSE public.ST_Distance(o.prev_position, o.position) / 1000.0
            END AS step_km,
            CASE
                WHEN o.prev_recorded_at IS NULL THEN 0
                -- Ignore gaps beyond 5 minutes, mirroring the C1.9 rule.
                WHEN o.recorded_at - o.prev_recorded_at > interval '5 minutes' THEN 0
                ELSE EXTRACT(EPOCH FROM (o.recorded_at - o.prev_recorded_at))
            END AS step_seconds
        FROM ordered o
    )
    INSERT INTO telemetry.location_summaries AS s (
        vehicle_id, bucket_start, bucket_seconds, shift_id,
        point_count, avg_speed_kph, max_speed_kph, distance_km,
        ignition_on_seconds, moving_seconds, idle_seconds,
        start_position, end_position
    )
    SELECT
        st.vehicle_id,
        st.bucket_start,
        300,
        (array_agg(st.shift_id ORDER BY st.recorded_at) FILTER (WHERE st.shift_id IS NOT NULL))[1],
        count(*)::integer,
        round(avg(st.speed_kph), 2),
        round(max(st.speed_kph), 2),
        round(sum(st.step_km)::numeric, 3),
        sum(CASE WHEN st.ignition THEN st.step_seconds ELSE 0 END)::integer,
        sum(CASE WHEN st.ignition AND coalesce(st.speed_kph, 0) > 3 THEN st.step_seconds ELSE 0 END)::integer,
        sum(CASE WHEN st.ignition AND coalesce(st.speed_kph, 0) <= 3 THEN st.step_seconds ELSE 0 END)::integer,
        (array_agg(st.position ORDER BY st.recorded_at))[1],
        (array_agg(st.position ORDER BY st.recorded_at DESC))[1]
    FROM stepped st
    GROUP BY st.vehicle_id, st.bucket_start
    ON CONFLICT (vehicle_id, bucket_start) DO UPDATE SET
        point_count         = EXCLUDED.point_count,
        avg_speed_kph       = EXCLUDED.avg_speed_kph,
        max_speed_kph       = EXCLUDED.max_speed_kph,
        distance_km         = EXCLUDED.distance_km,
        ignition_on_seconds = EXCLUDED.ignition_on_seconds,
        moving_seconds      = EXCLUDED.moving_seconds,
        idle_seconds        = EXCLUDED.idle_seconds,
        start_position      = EXCLUDED.start_position,
        end_position        = EXCLUDED.end_position;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- -----------------------------------------------------------------------------
-- telemetry.fn_drop_expired_location_partitions  (D6, 7.3)
-- -----------------------------------------------------------------------------
-- Aggregates first, then DROPs the whole partition. Refuses to drop anything
-- that has not been summarised, so retention can never silently destroy history.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION telemetry.fn_drop_expired_location_partitions(
    p_retention_days integer DEFAULT 90,
    p_dry_run        boolean DEFAULT true
)
RETURNS TABLE (partition_name text, month_start date, summarised_rows integer, dropped boolean)
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    r               record;
    v_cutoff        date := ((now() AT TIME ZONE 'UTC')::date - p_retention_days);
    v_month_start   date;
    v_rows          integer;
BEGIN
    FOR r IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'telemetry'
          AND c.relkind = 'r'
          AND c.relname ~ '^location_updates_y[0-9]{4}m[0-9]{2}$'
        ORDER BY c.relname
    LOOP
        -- Derive the month from the partition name's two capture groups.
        v_month_start := make_date(
            substring(r.relname from 'y([0-9]{4})m')::integer,
            substring(r.relname from 'm([0-9]{2})$')::integer,
            1
        );

        -- Only drop a partition whose entire range is older than the cutoff.
        CONTINUE WHEN (v_month_start + interval '1 month')::date > v_cutoff;

        v_rows := telemetry.fn_summarise_location_month(v_month_start);

        IF p_dry_run THEN
            partition_name := r.relname; month_start := v_month_start;
            summarised_rows := v_rows;   dropped := false;
            RETURN NEXT;
        ELSE
            EXECUTE format('DROP TABLE telemetry.%I', r.relname);
            partition_name := r.relname; month_start := v_month_start;
            summarised_rows := v_rows;   dropped := true;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION telemetry.fn_drop_expired_location_partitions(integer, boolean) IS
    '7.3/D6. Summarise-then-drop. Defaults to dry run so an accidental invocation cannot destroy data.';

-- -----------------------------------------------------------------------------
-- audit.fn_ensure_audit_partitions  (C6.5)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.fn_ensure_audit_partitions(p_years_ahead integer DEFAULT 1)
RETURNS TABLE (partition_name text, created boolean)
LANGUAGE plpgsql
SET search_path = app, telemetry, audit, public, pg_catalog
AS $$
DECLARE
    v_year_start date;
    v_year_end   date;
    v_name       text;
    v_exists     boolean;
    i            integer;
BEGIN
    FOR i IN 0..p_years_ahead LOOP
        v_year_start := make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'UTC'))::integer + i, 1, 1);
        v_year_end   := make_date(EXTRACT(YEAR FROM (now() AT TIME ZONE 'UTC'))::integer + i + 1, 1, 1);
        v_name       := format('audit_logs_y%s', to_char(v_year_start, 'YYYY'));

        SELECT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'audit' AND c.relname = v_name
        ) INTO v_exists;

        IF NOT v_exists THEN
            EXECUTE format(
                'CREATE TABLE audit.%I PARTITION OF audit.audit_logs '
                'FOR VALUES FROM (%L) TO (%L)',
                v_name, v_year_start, v_year_end
            );
            partition_name := v_name; created := true; RETURN NEXT;
        ELSE
            partition_name := v_name; created := false; RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS audit.audit_logs_default
    PARTITION OF audit.audit_logs DEFAULT;

SELECT * FROM audit.fn_ensure_audit_partitions(1);

-- -----------------------------------------------------------------------------
-- app.fn_retention_sweep_media  (C5.3, D5)
-- -----------------------------------------------------------------------------
-- Marks expired media for deletion. The object itself is removed from S3 by the
-- retention worker, which then stamps deleted_at. Legal hold and Object Lock
-- always win, so accident evidence cannot be swept.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.fn_media_due_for_deletion(p_limit integer DEFAULT 1000)
RETURNS TABLE (id uuid, bucket text, object_key text, retention_class app.retention_class)
LANGUAGE sql
STABLE
AS $$
    SELECT m.id, m.bucket, m.object_key, m.retention_class
    FROM app.media_objects m
    WHERE m.deleted_at IS NULL
      AND m.legal_hold = false
      AND m.object_lock_applied = false
      AND m.retain_until < CURRENT_DATE
    ORDER BY m.retain_until
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION app.fn_media_due_for_deletion(integer) IS
    'C5.3. Retention candidates. Object-Locked accident evidence and legal holds are excluded by construction.';
