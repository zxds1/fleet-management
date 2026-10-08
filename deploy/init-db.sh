#!/usr/bin/env bash
# =============================================================================
# deploy/init-db.sh — applies the schema and seed inside the postgres image.
#
# WHY THIS EXISTS: the Postgres entrypoint only executes *.sh / *.sql / *.sql.gz files that sit
# DIRECTLY in /docker-entrypoint-initdb.d. A bind-mounted *directory* there is skipped with
# "ignoring /docker-entrypoint-initdb.d/schema", so mounting ../db/schema produced a healthy
# container with an EMPTY database — pg_isready passed, the API connected, and every query failed
# on a missing relation. This script is the one entrypoint-visible file; it loops the real files in
# the documented order.
#
# Ordering: db/schema is lexicographic by design (zero-padded 00..16, so 12_fuel… precedes
# 12_training and 13_device… precedes 13_onboarding), then db/seed. `set -euo pipefail` means the
# first failing statement aborts and the entrypoint fails the container rather than leaving a
# half-built schema behind.
# =============================================================================
set -euo pipefail

SCHEMA_DIR=/docker-entrypoint-initdb.d/schema
SEED_DIR=/docker-entrypoint-initdb.d/seed

# Traccar keeps its OWN database on this same instance (N2.1/N2.2) and its image entrypoint is just
# `java -jar tracker-server.jar`, so nothing creates it: without this the traccar container exits and
# `api` (depends_on: traccar -> service_healthy) never starts. The Traccar server creates its own
# tables on first connect; only the database itself is ours to make.
if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname='traccar'" | grep -q 1; then
  echo "==> Creating the traccar database"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE traccar OWNER $POSTGRES_USER"
fi

if [ ! -d "$SCHEMA_DIR" ]; then
  echo "init-db: $SCHEMA_DIR is missing — the schema bind mount is wrong" >&2
  exit 1
fi

# Locally-run validation (db/validate.sh) also tolerates the PostGIS shim; the image has real PostGIS,
# so no shim is installed here.
echo "==> Applying schema"
for f in $(find "$SCHEMA_DIR" -maxdepth 1 -name '*.sql' | LC_ALL=C sort); do
  echo "  - $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

echo "==> Applying seed"
for f in $(find "$SEED_DIR" -maxdepth 1 -name '*.sql' | LC_ALL=C sort); do
  echo "  - $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

echo "==> init-db complete"