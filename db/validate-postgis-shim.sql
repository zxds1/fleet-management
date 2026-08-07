-- =============================================================================
-- db/validate-postgis-shim.sql
-- LOCAL VALIDATION ONLY. Production uses `CREATE EXTENSION postgis;` (real).
--
-- This supplies just enough of the `postgis` symbols for the fleet schema to
-- parse and apply against genuine PostgreSQL 16 in an environment where the
-- PostGIS binaries cannot be installed (no admin / StackBuilder blocked).
-- It does NOT implement real geometry math; it stores points as EWKT text and
-- returns deterministic place-holders. It exists so the DDL, constraints,
-- triggers, partitioning and views can be validated without PostGIS.
-- =============================================================================

SET search_path = app, telemetry, audit, public, pg_catalog;

-- The real type is binary; here we use text (EWKT). NOT NULL constraints still apply.
CREATE DOMAIN public.geography AS text
    CHECK (VALUE IS NOT NULL AND VALUE ~* '^SRID=\d+;POINT\(');

-- Allow 'SRID=4326;POINT(lon lat)'::geography literals.
CREATE FUNCTION public.geography(text)
RETURNS public.geography
LANGUAGE sql IMMUTABLE
AS $$ SELECT $1::public.geography; $$;

CREATE CAST (text AS public.geography) WITH FUNCTION public.geography(text) AS IMPLICIT;

-- Allow POINT(lon lat)::geography literals.
CREATE FUNCTION public.geography(point)
RETURNS public.geography
LANGUAGE sql IMMUTABLE
AS $$ SELECT ('SRID=4326;POINT(' || round($1[0]::numeric,6) || ' ' || round($1[1]::numeric,6) || ')')::public.geography; $$;

CREATE CAST (point AS public.geography) WITH FUNCTION public.geography(point) AS IMPLICIT;

-- ST_X / ST_Y: parse lon/lat out of the EWKT text.
CREATE FUNCTION public.ST_X(g public.geography) RETURNS float8
LANGUAGE sql IMMUTABLE
AS $$ SELECT substring(g FROM 'POINT\(([-\d.]+)')::float8; $$;

CREATE FUNCTION public.ST_Y(g public.geography) RETURNS float8
LANGUAGE sql IMMUTABLE
AS $$ SELECT substring(g FROM ' ([-\d.]+)\)')::float8; $$;

-- ST_Distance: not real metres, but returns a numeric so the summary aggregation parses.
CREATE FUNCTION public.ST_Distance(a public.geography, b public.geography) RETURNS float8
LANGUAGE sql IMMUTABLE
AS $$ SELECT 0.0::float8; $$;

-- `geometry` stand-in so `<geography>::geometry` casts in db/schema/11_views.sql parse.
CREATE DOMAIN public.geometry AS text;

CREATE FUNCTION public.ST_X(g public.geometry) RETURNS float8
LANGUAGE sql IMMUTABLE
AS $$ SELECT substring(g FROM 'POINT\(([-\d.]+)')::float8; $$;

CREATE FUNCTION public.ST_Y(g public.geometry) RETURNS float8
LANGUAGE sql IMMUTABLE
AS $$ SELECT substring(g FROM ' ([-\d.]+)\)')::float8; $$;

-- ST_Within: geofence containment (C3.7). Always false in the shim; production uses real PostGIS.
CREATE FUNCTION public.ST_Within(a public.geography, b public.geography) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$ SELECT false; $$;

-- Register a fake `postgis` extension so the unmodified `CREATE EXTENSION IF NOT EXISTS postgis`
-- in 00_extensions.sql is a no-op. In production this row is created by the real extension.
-- PostgreSQL 12+ exposes catalog `oid` as an ordinary column, so a manual INSERT
-- must supply it explicitly (there is no default sequence on pg_extension).
INSERT INTO pg_catalog.pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT (SELECT max(oid)::bigint + 1 FROM pg_catalog.pg_extension)::oid,
       'postgis',
       (SELECT oid FROM pg_roles WHERE rolname = current_user),
       (SELECT oid FROM pg_namespace WHERE nspname = 'public'),
       false,
       '3.4.0-shim'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis');

CREATE OR REPLACE FUNCTION public.postgis_full_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'LOCAL VALIDATION SHIM (not real PostGIS)'; $$;
