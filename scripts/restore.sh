#!/usr/bin/env bash
# Restore a fleet backup created by backup.sh.
# Usage: ./scripts/restore.sh <dump_file>
set -euo pipefail
FILE="${1:?dump file required}"
PGPASSWORD="${PGPASSWORD:-pg_local_dev}" pg_restore \
  -h "${PGHOST:-localhost}" -p "${PGPORT:-5444}" -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-fleet}" --clean --if-exists "$FILE"
echo "restored from: $FILE"
