#!/usr/bin/env bash
# Logical backup of the fleet database (pg_dump custom format).
# Usage: ./scripts/backup.sh [output_dir]
set -euo pipefail
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/fleet_${STAMP}.dump"
PGPASSWORD="${PGPASSWORD:-pg_local_dev}" pg_dump \
  -h "${PGHOST:-localhost}" -p "${PGPORT:-5444}" -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-fleet}" -Fc -f "$FILE"
echo "backup written: $FILE"
