# Load Tests

k6 load test scripts for the Helix Fleet Management platform. These scripts validate the telemetry ingest path and API read/write endpoints under sustained load, as required by [C5.8](docs/architecture/00-locked-decisions.md#c58).

> **Note:** k6 must be installed separately. k6 is not a Node.js package.
> - macOS: `brew install k6`
> - npm: `npm install -g @k6io/k6`
> - Linux: see [k6 install docs](https://grafana.com/docs/k6/latest/set-up-k6/install-k6/)

## Prerequisites

1. **k6** — installed globally (see installation commands above).
2. **Target environment** — either:
   - A running instance of the app (docker-compose or k8s port-forward) on `http://localhost:4000` (default), or
   - A remote staging/integration URL.
3. **Bearer token** — for authenticated endpoints (`api-reads.js` and `api-writes.js`), export a valid JWT:
   ```bash
   export BEARER_TOKEN="<your-admin-or-fleet-manager-jwt>"
   ```
4. **Webhook secret** (optional) — for HMAC-signed telemetry payloads, export the signing secret:
   ```bash
   export WEBHOOK_SECRET="<your-webhook-secret>"
   ```
   If unset, the telemetry test sends unsigned payloads (matches the API's pass-through behavior when `WEBHOOK_SECRET` is not configured).

## Test Scripts

### 1. `telemetry-ingest.js` — GPS webhook ingestion

Simulates 50 GPS trackers each posting a position every 10 seconds (the real Traccar ping interval per A2.4) for **5 minutes**.

| Parameter | Value |
|---|---|
| VUs | 50 |
| Interval | 10 s per VU |
| Duration | 300 s |
| Endpoint | `POST /api/v1/telemetry/webhook` |
| Payload | Traccar webhook shape: `deviceId`, `lat`, `lon`, `speed`, `heading`, `ignition`, `timestamp`, `attributes` (odometer, fuel, engineHours, satellites, hdop) |
| HMAC | SHA-256 via `x-signature` + `x-timestamp` headers if `WEBHOOK_SECRET` is set |
| p95 threshold | < 200 ms |
| p99 threshold | < 500 ms |
| Error rate | < 5% |

```bash
# Standalone
k6 run --env TARGET_URL=http://localhost:4000 \
  --env WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  scripts/loadtest/telemetry-ingest.js
```

### 2. `api-reads.js` — API read endpoints at 2× peak

Simulates 200 VUs (2× the ~100 expected peak concurrent users) polling four read endpoints sequentially with 2 s think time, for **10 minutes**.

| Parameter | Value |
|---|---|
| VUs | 200 |
| Think time | 2 s between requests |
| Duration | 600 s |
| Endpoints | `GET /api/v1/dashboard/vehicle-states`, `GET /api/v1/vehicles`, `GET /api/v1/shifts/me/active`, `GET /api/v1/incidents` |
| p95 threshold | < 500 ms |
| Error rate | < 1% |

```bash
# Standalone
k6 run --env TARGET_URL=http://localhost:4000 \
  --env BEARER_TOKEN="$BEARER_TOKEN" \
  scripts/loadtest/api-reads.js
```

> **`/incidents` note:** The `/api/v1/incidents` endpoint is referenced in C5.8's load-test scope. If the integration environment does not yet expose it, expect 404s on that endpoint. The test still exercises the other three endpoints and reports 404s as a counter; the overall pass/fail is based on the aggregate error rate and p95 latency.

### 3. `api-writes.js` — API write endpoints

Simulates 50 VUs each creating a fuel purchase via `POST /api/v1/fuel/purchases` with an `Idempotency-Key` header on every request, for **5 minutes**.

| Parameter | Value |
|---|---|
| VUs | 50 |
| Think time | 1 s between requests |
| Duration | 300 s |
| Endpoint | `POST /api/v1/fuel/purchases` |
| Idempotency-Key | UUIDv4 per request (`fuel-{vu}-{tick}-{timestamp}`) |
| Payload | RefuelSchema contract: `vehicle_id`, `fuel_card_last_four`, `litres`, `total_cost`, `odometer_km`, `purchased_at`, `before_fuel_record_id`, `after_fuel_record_id`, `receipt_media_object_id`, `supplier_name` |
| p95 threshold | < 2000 ms |
| Error rate | < 1% |

```bash
# Standalone
k6 run --env TARGET_URL=http://localhost:4000 \
  --env BEARER_TOKEN="$BEARER_TOKEN" \
  scripts/loadtest/api-writes.js
```

### 4. `run-all.sh` — Run all tests sequentially

Starts the app via docker-compose (or skips if `SKIP_START=1`), runs all three tests in order, collects JSON results into `scripts/loadtest/results/`, and exits non-zero if any test fails.

```bash
# Full run: start app, run all tests, tear down
./scripts/loadtest/run-all.sh

# Run against a remote/staging environment (skip starting the app)
TARGET_URL=https://staging.fleet.internal/api/v1 \
  BEARER_TOKEN="$BEARER_TOKEN" \
  WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  SKIP_START=1 \
  ./scripts/loadtest/run-all.sh

# Skip teardown so you can inspect containers
SKIP_START=1 SKIP_TEARDOWN=1 ./scripts/loadtest/run-all.sh
```

**Environment variables for `run-all.sh`:**

| Variable | Default | Description |
|---|---|---|
| `TARGET_URL` | `http://localhost:4000` | Base URL of the API (without trailing `/api/v1`) |
| `BEARER_TOKEN` | — | JWT for authenticated endpoints |
| `WEBHOOK_SECRET` | — | HMAC secret for telemetry signing |
| `SKIP_START` | — | Set to `1` to skip starting docker-compose |
| `SKIP_TEARDOWN` | — | Set to `1` to skip tearing down docker-compose |

## Interpreting Results

k6 outputs results to stdout and writes JSON summaries to `scripts/loadtest/results/`:

- **`<test-name>-summary.json`** — k6 aggregated summary (thresholds, metrics, checks). This is the file to inspect for pass/fail.
- **`<test-name>-results.json`** — full time-series data (optional, can be large).

Key metrics to check:

| Metric | What it means |
|---|---|
| `http_req_failed` (rate) | Fraction of requests with 4xx/5xx status. Must be below the error-rate threshold. |
| `p(95)` | 95th percentile response time. Must be below the latency threshold. |
| `p(99)` | 99th percentile response time (telemetry only). Must be below the latency threshold. |
| `checks` (passes/fails) | Per-request assertions (e.g., status code, body fields). |
| `iterations` | How many full request cycles completed. |

## Troubleshooting Threshold Failures

If a test fails its thresholds:

1. **High p95 latency** — investigate database slow queries (Postgres `pg_stat_statements`), Redis stream consumer lag, or connection pool exhaustion. Check `packages/api/src/http/routes/telemetry.ts` for the Redis `xadd` path and `packages/worker/src/ingest/consumer.ts` for the consumer.

2. **High error rate** — check application logs for 5xx errors. Common causes: database connection limits, Redis unavailable, or unhandled exceptions in the normalization/processing pipeline.

3. **k6 "no matching metrics" or "threshold failed"** — the test ran but the target wasn't reachable. Verify `TARGET_URL` and that the service is healthy (`curl $TARGET_URL/api/v1/telemetry/webhook`).

4. **401 on read/write tests** — set `BEARER_TOKEN` with a valid JWT from the authentication flow. The API uses self-issued JWT (HS256) per A3.7.

5. **401/403 on telemetry webhook** — if `WEBHOOK_SECRET` is set in the environment but the test doesn't pass it, set `WEBHOOK_SECRET` as an environment variable. The webhook middleware (`packages/api/src/security/webhookAuth.ts`) verifies `x-signature` and `x-timestamp` headers.
