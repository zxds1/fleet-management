#!/usr/bin/env bash
# =============================================================================
# db/validate.sh -- Schema validation harness
#
# Validates the full DDL + seed against PostgreSQL 16.
#
# The schema file list is DISCOVERED, not hard-coded: db/schema/*.sql in name
# order, exactly like db/validate.mjs (the harness CI uses). The previous
# hard-coded array stopped at 11_views.sql, so migrations 12..22 (tenancy,
# training, onboarding, vehicle issues, privacy requests, media scans,
# dead-letter, password reset) were never applied and the schema that CI
# validated was not the schema that ships.
#
# Paths are resolved from this script's own location, so it works from any
# working directory (`npm run db:validate:bash` runs it with db/ as cwd).
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
  "${PSQL[@]}" -d fleet -f "${ROOT_DIR}/db/validate-postgis-shim.sql"
fi

echo "==> Applying schema"
while IFS= read -r f; do
  echo "  - db/schema/$(basename "$f")"
  "${PSQL[@]}" -d fleet -f "$f"
done < <(find "${ROOT_DIR}/db/schema" -maxdepth 1 -name '*.sql' -type f | LC_ALL=C sort)

echo "==> Applying seed"
for f in $(find "${ROOT_DIR}/db/seed" -maxdepth 1 -name '*.sql' -type f | LC_ALL=C sort); do
  echo "  - db/seed/$(basename "$f")"
  "${PSQL[@]}" -d fleet -f "$f"
done

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
SELECT count(*) AS tenants FROM app.tenants;
SELECT count(*) AS rls_protected_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('app','telemetry') AND c.relrowsecurity AND c.relforcerowsecurity;
SELECT count(*) AS reset_codes FROM app.password_reset_codes;
SQL

echo "==> Schema validation PASSED (POSTGIS=${POSTGIS_MODE})"
