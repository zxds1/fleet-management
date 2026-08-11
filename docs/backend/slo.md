# Backend Design — Service Level Objectives (SLOs)

**Status:** Active. **Depends on:** `09-observability-ci.md` (telemetry §1, probes §2),
`03-rest-api.md` (routing), `04-telemetry-ingest.md` (ingest latency), `05-workers.md` (job latency).

This document defines the SLOs the Fleet Management Platform is measured against in production
(af-south-1, EKS). SLOs are validated against Prometheus metrics scraped from the `/metrics`
endpoint (`packages/api/src/http/routes/metrics.ts`) and surfaced on the Grafana dashboard
(`deploy/monitoring/grafana-dashboards.json`). CloudWatch alarms (`deploy/monitoring/alerts.yaml`)
fire when an SLO breaches its error budget burn rate.

---

## 1. SLO framework

| Concept | Definition |
|---|---|
| **SLI** | A ratio: good_events / total_events, measured over the window. |
| **SLO** | The 90-day target for each SLI. Exceeding the SLO means spending the error budget. |
| **Error budget** | 1 − SLO. Burn rate is computed over a 29-day lookback; a 14.4x burn rate for 2 h triggers an alarm. |
| **Alerting** | When the burn rate exceeds the threshold in §4, a PagerDuty page goes to the on-call engineer. |
| **Window** | All latency SLOs are evaluated over a rolling 29-day window with a 2-hour burn-rate alert. |

Service name: `fleet-api` (API), `fleet-worker` (background jobs), `fleet-ws` (WebSocket gateway).

---

## 2. Latency SLOs (P95)

| # | Service | SLI (P95) | SLO target | Metric |
|---|---|---|---|---|
| L-01 | API — read routes | P95 latency ≤ 200 ms | 99 % of requests | `fleet_http_request_duration_seconds` (route=~"/vehicles/.*\|/reports/.*\|/analytics/.*") |
| L-02 | API — write routes | P95 latency ≤ 600 ms (excludes idempotent uploads) | 95 % of requests | `fleet_http_request_duration_seconds` (route=~"/shifts/.*\|/fuel/.*\|/accidents/.*") |
| L-03 | Telemetry ingest webhook | P95 latency ≤ 80 ms (accept → Redis XADD) | 99 % of accepted positions | `fleet_http_request_duration_seconds` (route="/telemetry/webhook") |
| L-04 | Worker — job processing | P95 per-job ≤ 5 s (outbox relay), ≤ 30 s (OCR), ≤ 120 s (reconciliation) | 95 % of jobs | `fleet_worker_job_duration_seconds` (job=~"outbox_relay\|ocr\|reconciliation") |
| L-05 | WebSocket — event fan-out | P95 ≤ 150 ms from DB write to connected client | 99 % of events | measured via client RTT + server emit latency |
| L-06 | GPS webhook → Traccar | P95 ≤ 100 ms for Traccar-originated callbacks | 99 % of callbacks | `fleet_http_request_duration_seconds` (route="/telemetry/webhook") |

### Exclusion policy
Health probes (`/healthz`, `/readyz`, `/health/deep`, `/metrics`) are excluded from latency SLOs
and rate budgets — they are infrastructure, not user-facing surface area.

---

## 3. Availability / error rate SLOs

| # | Service | SLI | SLO target | Metric |
|---|---|---|---|---|
| A-01 | API — all routes | % of requests returning 5xx | ≤ 0.1 % (99.9 % success) | `fleet_http_requests_total{status=~"5.."}` |
| A-02 | API — auth routes | % of 401/403/429 | ≤ 0.5 % of auth attempts | `fleet_http_requests_total{status=~"4.."}` (route=~"/auth/.*") |
| A-03 | Telemetry ingest | % of 5xx on webhook | ≤ 0.5 % | `fleet_http_requests_total{status=~"5.."}` (route="/telemetry/webhook") |
| A-04 | Worker — job success | % of jobs completing without error | ≥ 99 % | `fleet_worker_jobs_total{result="error"}` |
| A-05 | DB connectivity | % of requests where DB is reachable | ≥ 99.95 % | `fleet_db_connections` (state="usable") |
| A-06 | Redis connectivity | % of requests where Redis is reachable | ≥ 99.9 % | derived from `fleet_redis_latency_seconds` |

### Error budget allocation
The API error budget (A-01) is shared across all user-facing routes. If 50 % of the budget is
consumed within 7 days, a partial rollback is triggered. If the budget is exhausted, an
incident is declared (C5.7: 2-hour response window for SLO breaches).

---

## 4. Derived SLIs and alerting thresholds

| Metric | Good / total | SLO | Burn-rate alert (29 d window) |
|---|---|---|---|
| `fleet_http_request_duration_seconds` P95 | good = ≤ threshold | L-01..L-06 | 144× for 2 h → immediate page |
| `fleet_http_requests_total` 5xx | good = 5xx=0 | A-01 | 36× for 2 h, 96× for 5 min → page |
| `fleet_worker_jobs_total` error | good = result!="error" | A-04 | 72× for 2 h → page |
| `fleet_db_connections` | usable connections / total | A-05 | < 99.95 % for 10 min → warn, 5 min → page |
| `fleet_redis_stream_depth` (traccar:positions) | lag < 5 000 | ingest freshness | > 10 000 for 5 min → warn, > 50 000 → page |
| `fleet_telemetry_ingest_lag_seconds` | lag ≤ 30 s | ingest freshness | > 30 s for 5 min → page |

### Burn-rate alert tiers
| Burn rate multiplier | Duration | Action |
|---|---|---|
| 144× | 2 h | Page on-call — SLO at risk within 2 weeks |
| 96× | 5 min | Page — fast burn, severe degradation |
| 36× | 2 h | Page — moderate burn |
| 6× | 2 h | Warning in #ops channel — slow burn |

---

## 5. Telemetry ingest freshness SLOs (special)

The Traccar ingest path (04-telemetry-ingest.md §2) is the platform's real-time spine. A
position accepted by the webhook must be processed by the worker and written to
`telemetry.location_updates` within the following targets:

| # | SLI | SLO target | Metric |
|---|---|---|---|
| T-01 | P95 ingest-to-process latency | ≤ 5 s | `fleet_telemetry_ingest_lag_seconds` |
| T-02 | P99 ingest-to-process latency | ≤ 30 s | `fleet_telemetry_ingest_lag_seconds` |
| T-03 | Stream depth (traccar:positions) | ≤ 5 000 pending | `fleet_redis_stream_depth{stream="traccar:positions"}` |
| T-04 | Position accept rate (webhook) | ≥ 1 000/s per pod | `fleet_telemetry_ingest_total{result="accepted"}` |

A breach of T-01 or T-03 triggers a PagerDuty page; T-02 is a warning threshold.

---

## 6. Dashboards and alert routing

| Dashboard | Panels | SLO section |
|---|---|---|
| API latency | /api, /auth, /telemetry/webhook, /vehicles, /reports | §2 |
| DB | connections, query latency, replication lag | §3, A-05 |
| Redis | command latency, stream depth, eviction | §2, §5 |
| Telemetry ingest | webhook accept rate, stream depth, ingest lag | §5 |
| Worker jobs | job count, duration, error rate | §2, §3 |

Alert routing (`deploy/monitoring/alerts.yaml`):
- 5xx, latency, ingest lag, stream depth → PagerDuty → on-call engineer.
- DB connections, Redis memory, worker error rate → #ops Slack channel (warning first).

---

## 7. Review cadence

SLOs are reviewed quarterly by the platform team. Targets may be tightened on a per-tenant
basis for Enterprise subscribers (C2.4: configurable per-tenant latency multipliers). Any
relaxation of an SLO requires a sign-off from the Head of Engineering.
