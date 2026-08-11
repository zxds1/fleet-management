#!/usr/bin/env bash
# scripts/loadtest/run-all.sh
# Runs all three k6 load tests sequentially against a target environment,
# collects results into scripts/loadtest/results/, and reports pass/fail.
#
# Usage:
#   ./run-all.sh                       # uses local docker-compose on localhost:4000
#   TARGET_URL=https://staging.fleet.internal/api/v1 ./run-all.sh
#   TARGET_URL=https://staging.fleet.internal/api/v1 BEARER_TOKEN=<jwt> ./run-all.sh
#   SKIP_START=1 ./run-all.sh          # skip starting the app, run tests only
#   SKIP_TEARDOWN=1 ./run-all.sh       # skip tearing down after tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
mkdir -p "${RESULTS_DIR}"

# ── Configuration ────────────────────────────────────────────────────────────
TARGET_URL="${TARGET_URL:-http://localhost:4000}"
export K6_WEB_URL="${K6_WEB_URL:-}"  # if you have a k6 cloud instance

# For authenticated endpoints, set BEARER_TOKEN in your environment.
# The webhook test can optionally use WEBHOOK_SECRET for HMAC signing.
if [[ -z "${WEBHOOK_SECRET:-}" ]]; then
  export WEBHOOK_SECRET=""
fi

# ── k6 availability check ─────────────────────────────────────────────────────
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed. Install with:"
  echo "  macOS:  brew install k6"
  echo "  npm:     npm install -g @k6io/k6"
  echo "  Linux:   see https://grafana.com/docs/k6/latest/set-up-k6/install-k6/"
  exit 1
fi

# ── Start the application (if not skipped) ──────────────────────────────────────
COMPOSE_FILE="deploy/docker-compose.yml"
COMPOSE_PROJECT="fleet-loadtest"
STARTED_COMPOSE=0

if [[ -z "${SKIP_START:-}" ]]; then
  echo "==> Starting application via docker-compose..."
  # Resolve the repo root from the script directory.
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"

  if [[ -f "${COMPOSE_FILE}" ]]; then
    docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" up -d --wait
    STARTED_COMPOSE=1
    echo "==> Application started at ${TARGET_URL}"
    # Give the app a moment to fully initialise.
    sleep 10
  else
    echo "==> docker-compose.yml not found at ${COMPOSE_FILE}"
    echo "==> Assuming target environment is already running at ${TARGET_URL}"
  fi
fi

# ── Helper: run a single test and capture its exit code ───────────────────────
run_test() {
  local name="$1"
  local script="$2"
  local result_file="${RESULTS_DIR}/${name}-summary.json"

  echo ""
  echo "========================================"
  echo "==> Running ${name}"
  echo "========================================"

  if k6 run \
    --env TARGET_URL="${TARGET_URL}" \
    --env WEBHOOK_SECRET="${WEBHOOK_SECRET}" \
    --env BEARER_TOKEN="${BEARER_TOKEN:-}" \
    --summary-export="${result_file}" \
    --out "json=${RESULTS_DIR}/${name}-results.json" \
    "${SCRIPT_DIR}/${script}"; then
    echo "==> ${name}: PASS"
    return 0
  else
    echo "==> ${name}: FAIL (k6 exited non-zero or thresholds failed)"
    return 1
  fi
}

# ── Run tests sequentially ────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0

if run_test "telemetry-ingest" "telemetry-ingest.js"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if run_test "api-reads" "api-reads.js"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if run_test "api-writes" "api-writes.js"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "==> Load test summary"
echo "========================================"
echo "  Passed: ${PASS_COUNT}"
echo "  Failed: ${FAIL_COUNT}"
echo "  Results written to: ${RESULTS_DIR}/"
echo "========================================"

# ── Teardown ──────────────────────────────────────────────────────────────────
if [[ "${STARTED_COMPOSE}" -eq 1 && -z "${SKIP_TEARDOWN:-}" ]]; then
  echo "==> Tearing down docker-compose..."
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT}" down -v
  echo "==> Teardown complete."
elif [[ -n "${SKIP_TEARDOWN:-}" ]]; then
  echo "==> Skipping teardown (SKIP_TEARDOWN set)."
fi

# ── Exit code ─────────────────────────────────────────────────────────────────
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "==> One or more load tests FAILED."
  exit 1
fi

echo "==> All load tests PASSED."
exit 0
