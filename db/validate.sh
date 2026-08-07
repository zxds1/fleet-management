#!/usr/bin/env bash
# =============================================================================
# db/validate.sh -- Schema validation harness
#
# Validates the full DDL + seed against PostgreSQL 16.
#
# In an environment WITHOUT the PostGIS binaries (e.g. a non-admin laptop where
# StackBuilder/winget cannot install them), pass POSTGIS=shim to install a tiny
# local stand-in for the `postgis` extension symbols. The shipped schema files
# are NOT modified; the shim only provides the geography type + ST_* functions
# so the real DDL parses and applies against genuine PostgreSQL 16. The shim is
# for LOCAL VALIDATION ONLY -- production uses the real PostGIS extension.
#
# Usage:
#   export PGPASSWORD=pg_local_dev
#   POSTGIS=shim PGURI='postgresql://postgres:pg_local_dev@localhost:5444/fleet' ./db/validate.sh
# =============================================================================
set -euo pipefail

PGURI="${PGURI:-postgresql://postgres:pg_local_dev@localhost:5444/fleet}"
POSTGIS_MODE="${POSTGIS:-real}"
PSQL=(psql "${PGURI}" --no-psqlrc --set ON_ERROR_STOP=1)

echo "==> Target ${PGURI%:*}  (POSTGIS=${POSTGIS_MODE})"

echo "==> Ensuring database exists"
if ! "${PSQL[@]}" -c "SELECT 1 FROM pg_database WHERE datname='fleet'" | grep -q 1; then
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE fleet"
fi

if [ "$POSTGIS_MODE" = "shim" ]; then
  echo "==> Installing local PostGIS shim (validation only)"
  "${PSQL[@]}" -d fleet -f db/validate-postgis-shim.sql
fi

SCHEMA=( \
  db/schema/00_extensions.sql \
  db/schema/01_enums.sql \
  db/schema/02_identity.sql \
  db/schema/03_platform_core.sql \
  db/schema/04_assets.sql \
  db/schema/05_operations.sql \
  db/schema/06_telemetry_hos.sql \
  db/schema/07_financial.sql \
  db/schema/08_safety.sql \
  db/schema/09_audit_notifications.sql \
  db/schema/10_partitions.sql \
  db/schema/11_views.sql \
)

echo "==> Applying schema"
for f in "${SCHEMA[@]}"; do
  echo "  - $f"
  "${PSQL[@]}" -d fleet -f "$f"
done

echo "==> Applying seed"
"${PSQL[@]}" -d fleet -f db/seed/01_seed.sql

echo "==> Post-apply smoke checks"
"${PSQL[@]}" -d fleet -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS location_partitions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='telemetry' AND c.relname ~ '^location_updates_y';
SELECT count(*) AS default_partitions
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE (n.nspname='telemetry' AND c.relname='location_updates_default')
    OR (n.nspname='audit' AND c.relname='audit_logs_default');
SELECT (SELECT count(*) FROM app.roles)            AS roles,
       (SELECT count(*) FROM app.permissions)      AS permissions,
       (SELECT count(*) FROM app.system_config)    AS config_rows,
       (SELECT count(*) FROM app.hos_policies)     AS hos_policies;
SELECT count(*) FROM app.v_vehicle_display_state;
SELECT count(*) AS chain_rows FROM app.fn_verify_accident_chain('00000000-0000-0000-0000-000000000000');
SQL

echo "==> Schema validation PASSED (POSTGIS=${POSTGIS_MODE})"
