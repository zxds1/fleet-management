# Service Boundary Definitions

**Platform:** Enterprise Fleet Management Platform
**Status:** Locked (v1.0)
**Companion documents:** `00-locked-decisions.md`, `api/openapi.yaml`, `db/schema/*`,
`deploy/docker-compose.yml`, `deploy/k8s/*`, `02-open-risk-register.md`

---

## 1. Topology at a glance

```
                         ┌────────────────────────────────────────────┐
                         │               AWS af-south-1               │
                         │  (RDS Postgres+PostGIS · ElastiCache · S3) │
                         └────────────────────────────────────────────┘
                                      ▲   ▲   ▲   ▲
        driver app (Expo)             │   │   │   │
   offline queue + Idempotency-Key ──┘   │   │   │
                                         │   │   │
            trackers ──▶ Traccar ─▶ Redis Stream ─┐
                                          │        │
                                   ingest-worker   │
                                          │        │ back-fill poller (5 min)
                                          ▼        ▼
                                    ┌──────────────────┐
                                    │  api (Express)   │──▶ WebSocket gateway (Socket.IO)
                                    │  + worker roles  │      driver polling / admin live map
                                    └──────────────────┘
                                          │
                              outbox_events ─▶ notif worker ─▶ FCM (N9) / Africa's Talking (A1.8) / email
```

Four deployable runtime groups are defined below. The **api** and **worker** are
the same container image with a command switch, so they share code and the
generated TypeScript types from `openapi.yaml`.

---

## 2. REST API (`api`)

**Responsibility:** All synchronous, request/response business operations. The
single source of contract truth is `api/openapi.yaml` (D7). The externally
supplied UI designs (A3.6) bind to these endpoints; the backend does not emit
HTML.

**Key behaviours:**
- **Auth:** JWT (HS256, A3.7). MFA (TOTP) mandatory for `ADMIN` / `FLEET_MANAGER`.
  Authorization is the **union** of all roles a user holds (N4). Permission codes
  are seeded in `db/seed/01_seed.sql`.
- **Idempotency (C5.1/D4):** every state-changing request must carry
  `Idempotency-Key: <uuid>`. The middleware upserts into `app.idempotency_keys`
  inside the same transaction (D8). A replay with the same key returns the stored
  response; a reused key with a different body returns `422 IDEMPOTENCY_CONFLICT`.
- **Single-transaction writes (D8):** domain mutation + audit row + `outbox_events`
  insert commit together. Side effects (push, SMS, escalation timers) are drained
  from the outbox by the worker, so they survive a crash between commit and dispatch.
- **Media (D5):** clients never POST bytes to the API. They call
  `POST /media/upload-url` (60s pre-signed S3 PUT), upload directly, then
  reference the returned `media_object_id`. S3 Object Lock is applied to the
  `ACCIDENT` retention class at mint time.
- **Soft delete (D3):** master tables reject hard deletes via
  `fn_reject_hard_delete`. The API sets `deleted_at`.
- **Retention transform (N3.3):** a pre-insert step computes the retained window
  `clock_in-15m … clock_out+15m` (configurable) and the active `recovery_modes`
  (N3.1) / open `accident_reports` (N3.2); positions outside this window for an
  off-shift vehicle are discarded before reaching the DB.
- **Cursor pagination + RFC7807** on every list endpoint (D7).

**Outbound calls (provisional, see risk register R-001):**
- Google Cloud Vision (A1.4) with Tesseract fallback.
- Africa's Talking (A1.8) for SMS.
- FCM (N9) for push, with delivery receipts.
- Google Maps Geocoding (C4.3) for trailer "last seen".

---

## 3. Telemetry ingestion (`ingest-worker` + Traccar)

**Source:** Traccar (A1.1) decodes 200+ tracker protocols and forwards positions.
**Transport (N2.3):** Traccar writes to a **durable Redis Stream** (not
fire-and-forget HTTP). The ingest worker consumes the stream, applies the
retention transform (§2), and writes `telemetry.location_updates`.

**Back-fill poller (N2.3):** every 5 minutes it reconciles Traccar's REST API over
a 30-minute lookback into `telemetry.location_updates` using the
`location_updates_traccar_dedupe` unique index, closing any gap if the stream or
the API briefly failed.

**Deduplication:** the `traccar_position_id` unique index makes both the stream
consumer and the back-fill poller idempotent.

**Derived state maintained by the worker:**
- `app.tracker_health` — last position/ignition/speed, `is_online` (N5), offline alert.
- `app.vehicle_movement_events` — off-shift movement (C5.6/N3), timestamp only.
- `telemetry.location_summaries` — rolled up during retention sweep (7.3).
- `app.driver_duty_segments` — inferred DRIVING / ON_DUTY / BREAK segments (N7/N8).
- `app.driver_hos_state` — recomputed rolling HOS, drives the C3.3 hard block.
- `app.shift` duration/distance where the shift is open.
- `app.v_vehicle_display_state` is a read-time view, not stored.

**Reliability:** Redis AOF is enabled (C5.10) so an ingest-worker restart or a
brief Redis outage does not lose buffered positions.

---

## 4. Background workers (`worker`)

Long-running and scheduled jobs. All read from `outbox_events` or operate on the
schedule below.

| Worker | Trigger | Responsibility |
|---|---|---|
| `notifications` | outbox | Drain `outbox_events`; send via FCM (N9) / Africa's Talking (A1.8) / email; honour quiet hours (C6.4); apply the 5-SMS-per-incident-per-15-min cap (A1.8); update `delivered_at` from FCM receipts. |
| `escalation` | `app.escalation_timers` | Accident acknowledgement within `accident.ack_timeout_minutes` (C6.3); escalate to next on-call tier then Head of Operations. |
| `accident-freeze` | outbox (accident created) | Clone ± window from `location_updates` into `accident_telemetry`, compute the SHA-256 hash chain (C3.4). |
| `maintenance-eval` | hourly | Roll `maintenance_schedules`; raise DUE_SOON / OVERDUE; optionally auto-quarantine if enabled (C3.12). |
| `document-expiry` | daily 01:00 | Scan `asset_documents`; set `is_operational=false` on owning asset (3.5); emit daily-at-T-7 alerts and weekly digest (B8). |
| `hos-recompute` | 5-min | Recompute `driver_hos_state` for active drivers from `driver_duty_segments`. |
| `stale-shift` | hourly (C3.8) | Flag open shifts > `shift.stale_open_hours` with tracker offline > `shift.stale_tracker_offline_hours`. |
| `efficiency-baseline` | daily (B6) | Recompute per-vehicle rolling baseline over last 30 shifts, min sample 5, else fleet fallback. |
| `fuel-anomaly` | 5-min | Run 2.5 rules against unprocessed purchases (gauge delta vs litres, card mismatch M2, expired card C2.3, efficiency deviation B6, price outlier, duplicate, odometer). |
| `partition-maint` | nightly | `fn_ensure_location_partitions` (next 3 months) and `fn_ensure_audit_partitions`; alert if `location_updates_default` is non-empty. |
| `retention` | nightly (7.3) | `fn_drop_expired_location_partitions` (summarise-then-drop, defaults to dry-run; prod runs wet), then `fn_media_due_for_deletion` → S3 delete → stamp `deleted_at`. Legal-hold / Object-Locked rows are excluded by construction. |
| `ocr` | queue | Send receipts to Google Vision (A1.4); on failure fall back to Tesseract; store `ocr_*` on `fuel_purchases`. |
| `reconciliation` | queue | Parse uploaded statement CSV via `column_mapping`; match on date+amount+last-four (A1.9). |

---

## 5. WebSocket gateway (`ws`)

**Transport:** Socket.IO (A1.6). Admin clients only; driver clients use HTTP
polling every 10s to conserve battery (A1.6).

**Channels:**
- `map:vehicle-states` — pushed on `tracker_health` / shift / HOS change. Each
  client receives the `display_state` from `app.v_vehicle_display_state` (N5
  precedence). Max **10 concurrent sessions per user** (A1.6), enforced in Redis
  with the audit trail in `app.user_sessions`.
- `notifications` — user-scoped push of `app.notifications` rows.
- `accident:live` — to on-call roster (C6.3) on `accident_reports` create.

**Backpressure:** state is recomputed server-side from the DB + Redis hash
`vehicle:{id}:state`; the gateway never holds the system of record.

---

## 6. Data ownership rules (consistency contract)

- **Our DB is authoritative for assets**; Traccar is authoritative for **devices**.
  Provisioning is one-way API→Traccar (N2.1); `traccar_device_id` is stored on
  `vehicles`.
- **Traccar's own history is purged on the same schedule** (N2.4) so the C5.6
  discard rule is not defeated by Traccar's tables.
- **Outbox is the only side-effect channel** (D8). No worker performs an external
  call inline within a request transaction.
- **Append-only tables** (`audit.audit_logs`, `accident_telemetry`,
  `accident_media`) reject UPDATE/DELETE by trigger (C6.5, C3.4).

---

## 7. Driver offline protocol

1. App queues every state-changing op with a fresh `Idempotency-Key`.
2. On reconnect, requests replay in order; the API's idempotency layer collapses
   duplicates (C5.1).
3. Offline PIN is bcrypt-hashed in the device keystore only (B12). After 5 fails
   → 15-min lockout; after 10 → local PIN hash wiped, forcing online re-login (M4).
4. A suspended driver's device-bound refresh token is invalidated server-side;
   next sync returns `403 ACCOUNT_SUSPENDED` (B13).
5. Max offline window 24h, then forced online login (B13).
