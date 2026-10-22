#!/usr/bin/env bash
# =============================================================================
# db/migrate.sh - apply db/schema/*.sql and db/seed/*.sql to $DATABASE_URL
#
# Used by the Kubernetes migration Job and by the API Deployment's init
# container, so the schema is applied exactly once whichever runs first:
#
#   * every file is recorded in public.schema_migrations with its sha256
#   * an already-applied file is skipped
#   * a file whose content CHANGED after it was applied aborts the run instead
#     of silently diverging from the database
#
# A session-level advisory lock serialises the Job and the init container, so
# two runners can never apply the same file at the same time.
#
# The seed is reference data only (roles, permissions, system_config, HOS
# policies, inspection and notification templates) and is idempotent, so it is
# applied together with the schema and is safe on every deployment.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

SCHEMA_DIR="${SCHEMA_DIR:-/app/db/schema}"
SEED_DIR="${SEED_DIR:-/app/db/seed}"
PSQL_BIN="${PSQL_BIN:-psql}"

for dir in "$SCHEMA_DIR" "$SEED_DIR"; do
  if [ ! -d "$dir" ]; then
    echo "migrate: directory not found: $dir" >&2
    exit 1
  fi
done

SCRIPT="$(mktemp -t fleet-migrate-XXXXXX.sql)"
trap 'rm -f "$SCRIPT"' EXIT

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

emit_file() {
  local file="$1" label="$2"
  local rel="${label}/$(basename "$file")"
  local sum
  sum="$(sha_of "$file")"

  echo "-- $rel"
  echo "SELECT (coalesce((SELECT checksum FROM public.schema_migrations WHERE name = '$rel'), '') = '$sum')::text AS checksum_ok \\gset"
  echo "\\if :checksum_ok"
  echo "\\else"
  echo "\\echo 'MIGRATION FILE CHANGED AFTER IT WAS APPLIED: $rel'"
  echo "SELECT 1/0;"
  echo "\\endif"
  echo "SELECT (NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = '$rel'))::text AS needs_apply \\gset"
  echo "\\if :needs_apply"
  echo "\\i $file"
  echo "INSERT INTO public.schema_migrations (name, checksum) VALUES ('$rel', '$sum') ON CONFLICT (name) DO NOTHING;"
  echo "\\endif"
}

{
  echo "\\set ON_ERROR_STOP on"
  echo "SELECT pg_advisory_lock(hashtext('fleet.schema_migrations'));"
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name       text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

  while IFS= read -r file; do emit_file "$file" "db/schema"; done \
    < <(find "$SCHEMA_DIR" -maxdepth 1 -name '*.sql' -type f | LC_ALL=C sort)
  while IFS= read -r file; do emit_file "$file" "db/seed"; done \
    < <(find "$SEED_DIR" -maxdepth 1 -name '*.sql' -type f | LC_ALL=C sort)

  echo "SELECT name, applied_at FROM public.schema_migrations ORDER BY name;"
} > "$SCRIPT"

echo "migrate: applying $SCHEMA_DIR and $SEED_DIR ..."
"$PSQL_BIN" "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --quiet --file "$SCRIPT"
echo "migrate: schema up to date"
