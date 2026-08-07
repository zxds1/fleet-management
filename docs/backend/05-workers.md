# Backend Design 05 — Background Workers

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md` (OutboxRelay §6,
IdempotencyService §5), `04-telemetry-ingest.md`, `docs/architecture/01-service-boundaries.md` §4,
`00-locked-decisions.md` (A1.4, A1.8, A1.9, B6, C1.11, C2.3, C3.3, C3.4, C3.8, C3.12, C6.3, M2, M4, N9).

This document specifies the worker process: the 13 jobs, their triggers, inputs/outputs,
idempotency, and how they drain the outbox. It is the implementation contract for `@fleet/worker`.
`ingest` is the same image in a different mode (`04`); this document covers the scheduled/queue jobs.

---

## 1. Execution model

- **Single image, command switch** (`00` §3): `worker` runs scheduled + queue jobs; `ingest` runs
  the telemetry consumer (`04`). Both share `@fleet/shared` types.
- **No inline external calls in request transactions** (D8). Every side effect (FCM N9, Africa's
  Talking A1.8, email, Traccar REST, Google Vision A1.4) happens here, triggered by an
  `outbox_events` row or a schedule.
- **Idempotency:** outbox handlers are idempotent (at-least-once, `01` §6). Scheduled jobs are
  keyed by the resource they touch and are safe to re-run (e.g. `hos-recompute` recomputes from
  the ledger, not increments).

---

## 2. Job catalogue

| # | Job | Trigger | Responsibility |
|---|---|---|---|
| 1 | `notifications` | outbox | Drain `outbox_events`; send via FCM (N9) / Africa's Talking (A1.8) / email; honour quiet hours (C6.4); apply 5-SMS-per-incident-per-15-min cap (A1.8); record `delivered_at` from FCM receipts. |
| 2 | `escalation` | `app.escalation_timers` | Accident ack within `accident.ack_timeout_minutes` (C6.3); escalate to next on-call tier then Head of Operations (`system_config.escalation.head_of_operations_user_id`). |
| 3 | `accident-freeze` | outbox (accident created) | Clone ± window from `location_updates` into `accident_telemetry` (N3.2); compute the SHA-256 hash chain (C3.4). If no data, mark `telemetry_available=false` (R-107). |
| 4 | `maintenance-eval` | hourly | Roll `maintenance_schedules`; raise DUE_SOON / OVERDUE (C3.11); optionally auto-quarantine if `maintenance.auto_quarantine_enabled` (default off, C3.12). |
| 5 | `document-expiry` | daily 01:00 | Scan `asset_documents`; set `is_operational=false` on owning asset (B8/C3.10); daily-at-T-7 alerts + weekly digest (B8). |
| 6 | `hos-recompute` | 5-min | Recompute `driver_hos_state` for active drivers from `driver_duty_segments` (N7); drives the C3.3 hard block. |
| 7 | `stale-shift` | hourly (C3.8) | Flag open shifts > `shift.stale_open_hours` with tracker offline > `shift.stale_tracker_offline_hours`; Admin alert. |
| 8 | `efficiency-baseline` | daily (B6) | Per-vehicle rolling baseline over last `fuel.efficiency_rolling_shifts` (30) shifts, min sample `fuel.efficiency_min_sample` (5), else fleet fallback. |
| 9 | `fuel-anomaly` | 5-min | Run the 2.5 rules against unprocessed purchases (below). |
| 10 | `partition-maint` | nightly | `fn_ensure_location_partitions` (next 3 months) + `fn_ensure_audit_partitions`; alert if `location_updates_default` non-empty. |
| 11 | `retention` | nightly | `fn_drop_expired_location_partitions` (summarise-then-drop, dry-run default → prod wet); then `fn_media_due_for_deletion` → S3 delete → stamp `deleted_at`. Legal-hold / Object-Locked rows excluded by construction (C5.3). |
| 12 | `ocr` | queue | Send receipts to Google Vision (A1.4); Tesseract fallback on failure/cost-cap; store `ocr_*` on `fuel_purchases`. Driver values remain authoritative until Admin verifies. |
| 13 | `reconciliation` | queue | Parse uploaded statement CSV via `column_mapping` (A1.9); match on date+amount+last-four. |

---

## 3. `fuel-anomaly` rules (expands `03` §4)

For each unprocessed `fuel_purchases` row:

1. **Gauge deviation** — `expected_rise% = litres / tank_capacity * 100`; deviation =
   `(after% − before%) − expected_rise%`; if `|deviation| > config('fuel.anomaly_gauge_deviation_pct')`
   (20) → `POSSIBLE_THEFT_OR_LEAK`.
2. **Card mismatch (M2)** — if `is_pooled=false` AND `assigned_vehicle_id ≠ purchase.vehicle_id`
   → `CARD_MISMATCH`. Pooled cards never raise it; submitting driver always logged.
3. **Expired card (C2.3)** — `card.expires_on < purchased_at` → accept + flag `EXPIRED_CARD` (never block).
4. **Efficiency deviation (B6)** — shift full-to-full and deviation from baseline >
   `fuel.efficiency_deviation_pct` (20) → `EFFICIENCY_DEVIATION`.
5. **Price outlier** — `unit_price` deviates > `fuel.price_outlier_pct` from 30-day mean →
   `PRICE_OUTLIER`.
6. **Duplicate / odometer** — `DUPLICATE_PURCHASE`, `ODOMETER_ROLLBACK`, `ODOMETER_DIVERGENCE`
   (M3, OBD cross-check advisory).
7. **Missing gauge evidence** — admin back-entry without before/after → `MISSING_GAUGE_EVIDENCE`.

CRITICAL anomalies emit a notification outbox (N9/A1.8). Scoring is asynchronous by design — the
sync refuel endpoint returns `open_anomalies:[]` (`03` §4).

---

## 4. `accident-freeze` + chain integrity (C3.4 / N3.2)

On `accident.created` outbox: clone the configured freeze window
(`accident.telemetry_freeze_before_minutes` / `_after_minutes`, default 5/1) from
`location_updates` into `accident_telemetry`, then compute a **SHA-256 hash chain** over the
cloned rows (each row hashes its payload + the previous row's hash). Any later tampering breaks
the chain; `GET /accidents/{id}/telemetry/verify` calls `fn_verify_accident_chain` and returns
per-row validity (`03` §2.4). `accident_telemetry` is append-only (trigger rejects UPDATE/DELETE).

---

## 5. Notification channel selection (C6.3 / C6.4 / N9)

- **High priority (accident escalation, mayday):** FCM direct (N9) with delivery receipt; SMS
  (Africa's Talking, `FLEET_ALERT`, E.164) as fallback timer if FCM unavailable (R-111). Critical
  accident SMS **always breaks through** quiet hours (C6.4).
- **Normal:** push during quiet hours suppressed; off-hours uses SMS/email per recipient prefs.
- **SMS cap:** `sms.max_per_incident_per_15min` (5) enforced per incident (A1.8).
- **On-call roster:** configurable (`system_config`); ack = first responder opens + taps Acknowledge
  (`03` §2.4), cancelling `escalation_timers`.

---

## 6. Retention & partition jobs (`06` detail)

- `partition-maint` pre-creates monthly `location_updates` partitions and the audit partitions so
  writes never hit the default. An alert fires if `location_updates_default` ever receives a row
  (means partitions fell behind).
- `retention` summarises each expiring location partition into `location_summaries` (losing raw
  detail per C5.3) **before** dropping the whole partition (D6). Media deletion respects
  Object-Lock legal hold (accident 7-yr) by excluding those rows by construction.

---

## 7. Invariants this document locks

1. No external side effect runs inside a request transaction; all flow through `outbox_events` (D8).
2. Outbox handlers are idempotent; scheduled jobs are safe to re-run.
3. Anomaly scoring is asynchronous and returns no anomalies synchronously (`03` §4).
4. Accident telemetry is hash-chained and append-only; verification is a query, not a mutation.
5. Retention drops whole partitions and never touches Object-Locked / legal-hold rows.

`06-repository-migrations.md` defines the data-access + migration contracts these jobs rely on.
