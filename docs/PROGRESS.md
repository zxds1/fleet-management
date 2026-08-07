# Implementation Progress

> Snapshot as of 2026-08-06. Source of truth: `docs/backend/IMPLEMENTATION-PROMPT.md` + the locked
> decision docs. Do not contradict `00-locked-decisions.md` / `02-open-risk-register.md`.

## ✅ Done

### Foundation (pre-existing / prior sessions)
- `packages/shared` + `packages/db` implemented and tested (`@fleet/db`: 5/5 jest passing).
- Live PG on `:5444`; schema/seed validated (`db/validate.mjs`, PostGIS shim).
- `packages/shared/src/types/db.ts` generated from live schema (44 enums, 68 relations, 24 location
  partitions, 6 roles, 59 permissions, 49 config rows).
- `api` / `worker` / `ws` scaffolded; `npm run build` + `npm run test` green.

### API foundation
- `server.ts`, `app.ts`, `container.ts`, `compose.ts` — Express boot, pool/Redis/config/token wiring.
- RFC7807 problem handler (`src/http/problem.ts`), `validate.ts`, `pagination.ts`, `requestContext.ts`.
- Middleware: `authenticate` (HS256 + Redis session check w/ degrade), `requirePermission`
  (role UNION, N4/C6.2), `idempotency` (C5.1/D4).
- Security: `tokens.ts` (HS256, current+previous key, MFA challenge), `passwords.ts` (argon2id),
  `crypto.ts` (AES-GCM `SecretBox`, recovery codes, stable hash), `totp.ts` (RFC 6238).
- `src/http/write.ts` — single-transaction write path with in-tx idempotency completion (D8).

### Auth domain (complete vertical slice)
- Repositories: `identity.ts` (users, permissions, drivers, sessions, devices, consents, recovery).
- Services: `AuthService`, `SessionService`, `MfaService`, `DeviceService`, `ConsentService`.
- Routes: `/auth/login`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout(-all)`, `/auth/mfa/enroll`,
  `/auth/mfa/confirm`, `/auth/devices(…/pin|/refresh|/revoke)`, `/auth/consent`.
- Unit tests: `AuthService.login` (6 cases) + `/healthz` smoke. **API build + tests green.**

### Shifts domain (complete)
- Repositories (`repositories/shifts.ts`): shifts, assignments, vehicles, work_logs, fuel_records,
  HOS state.
- `ShiftService`: clock-in (full guard chain → 08 §1 codes), clock-out, verify/flag (B18 unlock
  guard), force-close, getActive; `ShiftQuery.verificationInbox` (keyset cursor over
  `v_shift_verification_inbox`).
- Routes: `/shifts/clock-in`, `/clock-out`, `/me/active`, `/verification-inbox`, `/{id}/verify`,
  `/{id}/force-close`; `shift:*` permissions + idempotency on writes.
- Unit tests: `ShiftService.clockIn` (7 cases). **API build + 14 tests green.**

### Fuel domain (complete)
- Repositories (`repositories/fuel.ts`): purchases, cards, statements.
- `FuelService` (submitRefuel + verifyPurchase), `FuelCardService`, `ReconciliationService`,
  `FuelQuery.reconciliationInbox`.
- Routes: `/fuel/refuel`, `/fuel/purchases/{id}/verify`, `/fuel/cards`, `/fuel/reconciliation-inbox`,
  `/reconciliation/statements`; `fuel:*` permissions + idempotency on writes. Async anomaly scoring
  queued via `fuel.ocr` outbox.
- Unit tests: `FuelService` (submitRefuel + verifyPurchase state machine). **API build + 19 tests green.**

### Accidents domain (complete)
- Repositories (`repositories/accidents.ts`): reports (custom `insertReport` w/ geography), media
  (append-only + primary-slot check), escalation timers.
- `AccidentService`: `mayday` (B17 escape hatch → `accident.escalate` outbox + durable timer), `create`
  (PENDING), `attachMedia` (append-only, `DUPLICATE` on repeated primary slot), `acknowledge`
  (cancels escalation timers, C6.3); `AccidentQuery.verifyChain` (hash chain, C3.4).
- Routes: `/accidents/mayday`, `/accidents`, `/accidents/{id}/media`, `/accidents/{id}/telemetry/verify`,
  `/accidents/{id}/acknowledge`; `accident:*` permissions + idempotency on writes.
- Unit tests: `AccidentService`/`AccidentQuery`. **API build + 28 tests green.**

### Inspections domain (DVIR) (complete)
- Repositories (`repositories/inspections.ts`): inspections, items, photos, templates, template items,
  quarantine (+ `TrailerRepository` in shifts.ts).
- `InspectionService.submit` (03 §2.5, C1.5/C1.6): insert inspection+items+photos in one tx; `DEFECTS_NOT_REVIEWED`,
  `DVIR_FAIL_NEEDS_PHOTO`, FAIL-requires-notes; BLOCKER failure quarantines asset + sets non-operational; audit +
  `inspection.submitted` outbox.
- Route: `POST /inspections`; `inspection:submit` permission + idempotency. Returns `{ inspection_id, block_shift }`.
- Unit tests: `InspectionService.submit` (7 cases). **API build + 35 tests green.**

### Trailer domain (complete)
- Repositories (`repositories/trailer.ts`): `TrailerAssignmentRepository` (active-by-vehicle / active-by-trailer).
- `TrailerService.swap` (03 §2.6, 1.3): close active assignment (drop to bobtail) + hook new trailer (existing
  or driver-created external C1.11, `is_external`); TRAILER_SWAP inspection required; double-hook guarded
  (`DUPLICATE`); updates `trailers.current_vehicle_id`; audit + `trailer.swap` outbox.
- Route: `POST /trailer/swap`; `trailer:swap` permission + idempotency. Returns `{ trailer_assignment_id,
  dropped_trailer_id, created_trailer_id }`.
- Unit tests: `TrailerService.swap` (7 cases). **API build + 42 tests green.**

### Media + Insights domain (complete)
- Repositories (`repositories/media.ts`): `MediaObjectRepository`.
- `MediaService.uploadUrl` (03 §2.7, D5, C5.3): pre-insert media_objects, ACCIDENT → Object-Locked bucket,
  `retain_until` from `system_config` threshold, 60s presigned PUT; audit staged. `MediaPresigner` boundary
  (real SigV4 signing deferred).
- `AnomalyQuery.feed` (v_open_anomalies, D7), `DocumentQuery.expiring` (asset_documents window), `DashboardQuery.
  vehicleStates` (v_vehicle_display_state, N5).
- Routes: `POST /media/upload-url`, `GET /anomalies`, `GET /documents/expiring`, `GET /dashboard/vehicle-states`.
- Unit tests: media + insights queries (7 cases). **API build + 50 tests green.**

### Worker domain — ingest + outbox + 13 jobs (begun, 04 / 05)
- Foundation (`src/config/env.ts`, `config/redis.ts`, `infra.ts`, `index.ts`): argv `--role worker|ingest`,
  pool + Redis + typed `ConfigClient` (C2.4), graceful shutdown.
- **Ingest (04)**: `traccar.ts` (position contract + parser), `retention.ts` (pure C5.6/N3 discard transform,
  unit-tested), `derive.ts` (pure tracker-health + off-shift movement ledger, unit-tested), `repository.ts`
  (`TelemetryRepository`: location_updates insert, tracker_health upsert, movement events, trailer last-known,
  retention context), `consumer.ts` (Redis Stream `traccar:positions` → retain/derive/persist, one tx/vehicle),
  `backfill.ts` (Traccar REST poller, idempotent on `traccar_position_id`).
- **Outbox relay (D8)**: `PgOutboxRelay` + handlers for `accident.escalate` (freeze + page on-call tier 1 + arm
  timer), `fuel.ocr`, `reconciliation.statement`, `inspection.submitted`.
- **13 jobs (05 §2)**: `notifications` (quiet hours C6.4 + SMS cap A1.8, unit-tested), `escalation` (C6.3,
  planner + job unit-tested), `hos-recompute` (N7/C3.3), `fuel-anomaly` (seven rules, pure + unit-tested),
  `ocr`, `reconciliation`, `maintenance-eval` (C3.11/12), `document-expiry` (B8/C3.10), `stale-shift` (C3.8),
  `efficiency-baseline` (B6), `accident-freeze` (N3.2/C3.4 hash chain), `partition-maint` (06),
  `retention` (D6, dry-run default). Scheduler with documented cadences.
- Unit tests: retention, derive, fuel-anomaly, notifications, escalation, ingest E2E — **28 passing**, worker
  `tsc -b` clean.

## 🚧 Remaining

### API domains (handlers + services + repositories)
- [x] **Shifts** (`03` §2.2): clock-in/out/verify/force-close/active/inbox; full clock-in flow + all
      `08` §1 error codes (`NO_ASSIGNMENT`, `ODOMETER_DECREASED`, `CONSENT_REQUIRED`,
      `SHIFT_ALREADY_OPEN`, `CLOCKOUT_PENDING`, `HOS_REST_BLOCKED`, `UNLOCK_REQUIRED`, `DUPLICATE`).
      `v_shift_verification_inbox` cursor pagination. Tests green.
- [x] **Fuel** (`03` §2.3): `submitRefuel` (gauge pair + async OCR/anomaly outbox), `verifyPurchase`
      (VERIFY/REJECT/CLEAR_PAYMENT + C6.1 gate), `FuelCardService.create` (pooled XOR vehicle),
      `ReconciliationService.importStatement` (outbox), `FuelQuery.reconciliationInbox`. Tests green.
      Seed gap: `fuel:enter` permission not yet present.
- [x] **Accidents** (`03` §2.4): mayday (B17), create, media attach (Object-Lock bucket D5), telemetry
       hash-chain verify (C3.4), acknowledge cancels escalation timer (C6.3). Tests green.
- [ ] **Fuel** (`03` §2.3): refuel, odometer-decrease rejection, gauge photo, reconciliation inbox,
       anomaly flagging.
- [x] **Inspections** (`03` §2.5): DVIR create/verify, severity matrix (R-104), photo requirement.
- [x] **Trailer** (`03` §2.6): assignments, swaps (hook/drop, external trailer C1.11), last-known location table exists.
- [x] **Media** (`03` §2.7): 60 s presigned PUT (`MediaService.uploadUrl`), retention classes, ACCIDENT → Object-Locked bucket (C5.3).
- [x] **Dashboard / Anomalies / Documents** query services + handlers (`AnomalyQuery.feed`, `DocumentQuery.expiring`, `DashboardQuery.vehicleStates`).

### Cross-cutting (all packages)
- [ ] **Media presign service** (`src/media/MediaService`) + `openapi.yaml` single HTTP contract; zod↔
       OpenAPI contract tests (`npm run contract`). Service + `MediaPresigner` boundary implemented; real AWS SigV4
       signing is the remaining gate (deferred dependency).
- [ ] **Integration tests** against throwaway PG: odometer-decrease, idempotency replay, DVIR-fail-photo,
      soft-delete rejection.
- [ ] **Unit test coverage ≥ 80 %** on every new service (fake repos, `Result`-based).
- [ ] Append-only table guards (`audit_logs`, `accident_telemetry`, `accident_media`).

### Worker (`@fleet/worker`)
- [x] Ingest consumer + backfill + derive (`04`,`05`) — implemented; needs `:5444` integration pass.
- [x] 13 jobs from `05-workers.md` §2 — implemented (scheduler + handlers wired).
- [x] `PgOutboxRelay.start()` + per-`event_type` handlers — wired in `outbox/relay.ts`.
- [ ] **Integration tests** against `:5444`: ingest end-to-end (Redis Stream → location_updates), every job's
      SQL validated against live schema, accident-freeze hash chain, outbox at-least-once + dead-letter.
- [ ] **Real AWS SigV4 signing** for media deletion in `retention` job (deferred dependency).
- [ ] **Email transport** provider wiring (currently a logged no-op).

### WebSocket gateway (`@fleet/ws`)
- [ ] Socket.IO server, token auth, 10-session cap, snapshot-on-connect, channels (map/notifications/
      accident) per `07`.

### Observability & CI (`09`)
- [ ] Sentry hook, `/health/deep`, GitHub Actions pipeline + sign-off gate checks.
- [ ] Hard launch gates: **R-101** DPIA, **R-103** HOS/emergency numbers, **R-104** DVIR matrix (legal).

### Seed / data gaps
- [ ] Permission codes `MANAGE_OWN_MFA`, `REVOKE_DEVICE` (and any other referenced codes) not yet in
      `db/seed` — auth routes wired but will 403 until grants exist.
