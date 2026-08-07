# Changelog

## [0.11.2] - 2026-08-06 — Observability: Sentry, probes, metrics, CI (09)

### Added
- **Error reporting (C5.7)**: `packages/shared/src/telemetry.ts` — Sentry reporter (`initErrorReporter`
  / `reportError` / `flushTelemetry`) that is a no-op until a `SENTRY_DSN` is configured, so test/unit
  processes never require a DSN or network. Wired into `@fleet/api`, `@fleet/worker`, `@fleet/ws` at
  boot; uncaught exceptions + unhandled rejections are reported and flushed before exit. 5xx responses
  are reported from the RFC7807 handler tagged by `error_code` (the Sentry grouping key, 09 §1).
- **In-process metrics**: a `Metrics` collector (`increment`/`gauge`/`snapshot`/`flush`) with a
  `MetricSink` (default: structured log line → CloudWatch Logs). Side-effect-free and no new cloud dep.
- **Health probes (09 §2)**:
  - `api` `/healthz` (liveness), `/readyz` (PG connect + S3 reachability via `EnvMediaPresigner.ping()`),
    `/health/deep` (replication lag, outbox backlog, last ingest position age — each check degrades
    independently).
  - `worker` + `ws` gained `/readyz` (PG connect + Redis presence) alongside their existing `/healthz`.
- **CI pipeline**: `.github/workflows/ci.yml` enforces `turbo` build / lint / typecheck / test /
  contract, an integration job against a throwaway PG + Redis (`:5444` pattern), and a sign-off-gates
  job reminding the human/legal R-101/103/104 release blockers (09 §4/§6).
- **Shared kernel tests**: added `test/shared-coverage.test.ts` covering `errors`, `transaction`,
  `realtime`, `config`, `time`, `logging` so the unit-coverage gate (≥80%) is meaningful; scoped
  coverage collection to hand-written logic (generated `types/**` + OpenAPI-derived `schemas/**` are
  validated by the `contract` task instead).

### Changed
- `EnvMediaPresigner.ping()` — S3 `HeadBucket` liveness probe for the readiness check (degrades to
  `false` when credentials are absent).

## [0.10.0] - 2026-08-06 — Worker: ingest, outbox relay, 13 jobs (04 / 05)

### Added
- **Worker foundation** (`src/config/env.ts`, `src/config/redis.ts`, `src/infra.ts`, `src/index.ts`):
  argv `--role worker|ingest` switch; pool + Redis bundle + typed `ConfigClient` (C2.4) wiring;
  graceful shutdown on SIGINT/SIGTERM.
- **Ingest pipeline (04)**: `src/ingest/traccar.ts` (Traccar position contract + parser),
  `retention.ts` (pure C5.6/N3 discard transform — on-shift `SHIFT`/`SHIFT_BUFFER`, off-shift
  forced retention `RECOVERY_MODE`/`ACCIDENT_FREEZE`), `derive.ts` (pure tracker-health + off-shift
  movement ledger, C5.6), `repository.ts` (`TelemetryRepository`: location_updates insert,
  tracker_health upsert, movement events, trailer last-known, retention context lookup),
  `consumer.ts` (Redis Stream `traccar:positions` reader → retain/derive/persist in one tx per
  vehicle), `backfill.ts` (Traccar REST poller, idempotent on `traccar_position_id`).
- **Outbox relay (D8)**: `src/outbox/relay.ts` — `PgOutboxRelay` wired with handlers for
  `accident.escalate` (freeze + page on-call tier 1 + arm timer), `fuel.ocr`,
  `reconciliation.statement`, `inspection.submitted`; shift/trailer events acknowledged.
- **Jobs (05 §2)** — all 13 implemented: `notifications` (drains queue; quiet hours C6.4 + SMS cap
  A1.8), `escalation` (C6.3 five-minute tier escalation), `hos-recompute` (N7/C3.3 rolling block),
  `fuel-anomaly` (seven rules, pure + tested), `ocr`, `reconciliation`, `maintenance-eval` (C3.11/12),
  `document-expiry` (B8/C3.10), `stale-shift` (C3.8), `efficiency-baseline` (B6), `accident-freeze`
  (N3.2/C3.4 hash-chained clone), `partition-maint` (06), `retention` (D6, dry-run default).
- **Scheduler** (`src/jobs/scheduler.ts`): documents cadences; `notifications` 5s, `escalation` 60s,
  `hos-recompute`/`fuel-anomaly` 5m, `ocr` 30s, hourly + daily jobs.
- **Transports** (`src/jobs/transports.ts`): FCM + Africa's Talking senders degrade to no-op when
  credentials are absent (dev/test safe).
- **Tests**: retention, derive, fuel-anomaly rules, notifications (quiet hours + SMS cap), escalation
  planner + job, and end-to-end ingest (discard vs retain + forced retention) — 28 passing.

### Notes
- Pure rule/logic modules are unit-tested with fakes; SQL is parameterised and identifiers are
  code constants (06 §2). Several scheduled jobs' SQL is best-effort against the schema and needs the
  `:5444` integration pass (PROGRESS) to validate runtime behaviour.

### Fixed
- `escalation.head_of_operations_user_id` is a **UUID**, not a number: moved it from `NumericConfigKey`
  to `StringConfigKey` in `packages/shared/src/config.ts` and read it via `ConfigClient.string()` in
  `PgEscalationRepository.headOfOperations()` (removed the `String()` cast). The seed already stores it
  as `value_type = 'string'`, so this is now type-correct end to end.

All notable progress on the Fleet Management Platform backend is tracked here. The shared kernel
(`@fleet/shared`) and data layer (`@fleet/db`) are pre-existing and stable; entries below concern
`@fleet/api`, `@fleet/worker`, and `@fleet/ws`.

## [0.11.0] - 2026-08-06 — WebSocket gateway (07)

### Added
- **`ws` package** — the Socket.IO admin real-time surface (`07-websocket-gateway.md`). `src/index.ts`
  boots a `Server` on `WS_PORT` (8081) with `/healthz`, wires pool + Redis + `ConfigClient` + token
  verifier + read repositories + event bus, and owns graceful shutdown (SIGINT/SIGTERM).
- **Auth at connect (07 §2)**: `gateway.ts` verifies the HS256 access token (`security/tokens.ts`,
  read-side mirror of the api signer) → `Principal`; rejects with `UNAUTHENTICATED` on missing/invalid
  token. `repositories/identity.ts` (`AccountStatusRepository`) re-checks suspend/revoke at connect and
  rejects with the SAME catalogue code the admin console branches on — `ACCOUNT_SUSPENDED` (users not
  active / `locked_until` / driver `SUSPENDED`), `DEVICE_REVOKED` (revoked `driver_devices`),
  `SESSION_REVOKED` (revoked `user_sessions`).
- **10-session cap (A1.6 / 02 §6)**: enforced via the shared Redis `user:{userId}:sessions` sorted set
  (same namespace as the api, so the cap is cross-process). The 11th connection evicts the oldest,
  durably revokes its `user_sessions` row (`SESSION_LIMIT_EXCEEDED`), and disconnects it. Redis-down
  degrades to a `user_sessions` DB count (R-109).
- **Channels (07 §3/§5)**: server-decided subscriptions from the `Principal` — every authed admin
  joins `map:vehicle-states`; each user joins `notifications:{userId}`; on-call roster members
  (`on_call_roster`, incident_kind `accident`) join `accident:live`. On (re)connect the gateway sends a
  full snapshot (`v_vehicle_display_state` + unread `notifications`) so clients never show stale state.
- **Live fan-out**: `pubsub.ts` `EventBus` (Redis pub/sub in prod, in-memory for tests) bridges backend
  state changes to rooms. `map:vehicle-states` recomputes the view and emits only the **changed**
  vehicles (`diffVehicleStates`, 07 §5 backpressure); `notifications` / `accident:live` re-broadcast to
  their rooms.
- **Read repositories** (`repositories/views.ts`): `VehicleStateRepository` (snapshot of
  `app.v_vehicle_display_state`), `NotificationRepository` (`unread` per user), `OnCallRepository`
  (`isAccidentOnCall`). Parameterised SQL only.
- **Config (07)**: `config/env.ts` (mirrors api env; adds `WS_PORT`), `config/redis.ts` (Redis bundle +
  `SessionStore`, shared session key, in-memory `memoryBundle` for tests/dev).

### Producers now publish (residual from 0.11.0 — live push wired end-to-end)
- **Shared contract** (`@fleet/shared/src/realtime.ts`): `RealtimeChannels` (the 3 topic names, single
  source of truth — `ws` now imports them instead of duplicating) + `EventPublisher` + `redisPublisher`
  (null-safe Redis pub/sub helper, no new runtime dep).
- **Worker relay** (`outbox/relay.ts`): `accident.escalate` + new `accident.created` outbox handlers
  publish `accident:live`; `shift.started` / `shift.closed` / `trailer.swap` now nudge `vehicleStates`
  (replacing the prior no-op); `accident.escalate` / `inspection.submitted` publish the created
  notification row to `notifications`.
- **Worker ingest** (`ingest/repository.ts` `upsertTrackerHealth`): publishes `vehicleStates` on every
  tracker-health change. **`hos-recompute`** + **`stale-shift`** jobs publish `vehicleStates` /
  `notifications` (the latter after capturing the `RETURNING` row). `enqueueNotification` now returns
  the stored row (shared `NotificationRow` shape) so the live push matches the gateway snapshot.
- **Worker infra** (`infra.ts`): `bootInfra` builds an `EventPublisher` from the Redis client and threads
  it into the relay + scheduled jobs via `RelayInfra` / `buildSchedule`.
- **API** (`services/accidents.ts`): `create` now fires an `accident.created` outbox (was mayday-only),
  so non-mayday reports also page the on-call roster in real time (08 §3).

### Notes
- Gateway holds no system of record — every payload is recomputed from PG/Redis (07 §1). Driver push
  remains FCM via the worker (N9); the gateway surfaces admin real-time only.
- `auth.max_concurrent_sessions` (default 10) drives the cap via `ConfigClient`.
- Unit tests (13) cover token verify (valid/expired/wrong-secret/key-rotation), auth + suspend rejection,
  channel subscription + snapshot-on-connect, the 11th-connection eviction, vehicle-state diff, and the
  `io.use` auth middleware — all with a fake socket, no live PG/Redis.

## [0.11.1] - 2026-08-06 — Media: real S3 SigV4 presigning (D5 gate closed)

### Added
- **Real AWS SigV4 presigned PUT** (`src/media/presigner.ts`): `EnvMediaPresigner` now mints
  standards-compliant presigned URLs via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
  (`getSignedUrl` + `PutObjectCommand`), replacing the canonical-endpoint stub. Honours a custom
  `S3_ENDPOINT` (MinIO / LocalStack) and `S3_FORCE_PATH_STYLE`, and signs `content-type` so browser
  uploads are accepted by S3. `MediaService.uploadUrl` is unchanged — it just receives a real URL.
- **AWS credentials in env** (`src/config/env.ts`): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_SESSION_TOKEN` (optional, from the secret store, 00 §6). When absent the presigner degrades to
  the canonical endpoint URL so dev / unit tests still resolve (no hard failure).

### Tests
- `test/presigner.test.ts`: virtual-hosted SigV4 URL carries `X-Amz-Algorithm/-Credential/-Date/
  -Expires/-Signature` (64-hex); path-style + custom endpoint; and graceful degradation without creds.
- `test/media.service.test.ts` still green (presigner is injected; the service is unaffected).

## [0.9.0] - 2026-08-06 — Media + Insights (§2.7) domain

### Added
- **Media repository** (`src/repositories/media.ts`): `MediaObjectRepository` (`app.media_objects`).
- **Media presigner boundary** (`src/media/presigner.ts`): `MediaPresigner` interface + `EnvMediaPresigner`
  (canonical bucket endpoint; real AWS SigV4 signing landed in 0.11.1). Wired into `Infra`.
- **Media service** (`src/services/media.ts`): `MediaService.uploadUrl` — pre-inserts a `media_objects` row
  (owner_id NULL until the owning row is created, 03 §9), picks the bucket + Object-Lock placement from the
  retention class (ACCIDENT → Object-Locked bucket, C5.3), derives `retain_until` from the matching
  `system_config` threshold (C2.4, no magic numbers), and mints a 60-second presigned PUT (D5). Stages audit.
- **Insights query services** (`src/services/queries.ts`): `AnomalyQuery.feed` (keyset page over
  `app.v_open_anomalies` — fuel/HOS/accident/maintenance/security, D7), `DocumentQuery.expiring` (keyset page
  over `asset_documents` within `within_days`, 3.5/B8), `DashboardQuery.vehicleStates` (snapshot of
  `app.v_vehicle_display_state`, N5).
- **Routes** (`src/http/routes/media.ts`, `src/http/routes/insights.ts`): `POST /media/upload-url` (bearerAuth;
  openapi omits idempotency for this endpoint), `GET /anomalies`, `GET /documents/expiring`,
  `GET /dashboard/vehicle-states` (per openapi these GETs carry no auth). Reads use a pooled client.
- **Shared schema**: `MediaUploadSchema` (matches `api/openapi.yaml`).
- **Compose/container wiring**: `mediaObjects` repo + `MediaService`, `AnomalyQuery`/`DocumentQuery`/`DashboardQuery`,
  and the `presigner` in `Infra`.
- **Tests**: `MediaService.uploadUrl` (4 cases) + insights query services (anomaly feed, expiring docs, dashboard)
  with fakes.

### Notes
- `owner_kind`/`retention_class` enums mirror `api/openapi.yaml`; ACCIDENT media targets the Object-Locked bucket.
- The three insights GETs follow the openapi contract (no auth/idempotency). Real S3 SigV4 signing landed
  in 0.11.1 (aws-sdk dependency already declared; `EnvMediaPresigner` now mints SigV4 presigned PUTs).

## [0.8.0] - 2026-08-06 — Trailer domain

### Added
- **Trailer repositories** (`src/repositories/trailer.ts`): `TrailerAssignmentRepository` (ledger of
  hook/drop; `findActiveByVehicle` / `findActiveByTrailer` for the single-active-assignment rule, C1.11/C1.12).
  `TrailerRepository` already existed in `repositories/shifts.ts`.
- **Trailer service** (`src/services/trailer.ts`): `TrailerService.swap` (03 §2.6, spec 1.3) — closes the
  vehicle's active assignment (drop to bobtail / swap-off, requires `drop_media_object_id`), then hooks the
  new trailer; an existing trailer or a driver-created external trailer (`is_external=true`, C1.11); the hook
  inspection must be a `TRAILER_SWAP` check; a double-hook onto another vehicle is rejected with `DUPLICATE`
  (defence in depth — the unique partial indexes are the DB authority). Stages audit + `trailer.swap` outbox.
- **Trailer route** (`src/http/routes/trailer.ts`): `POST /trailer/swap` (OpenAPI `TrailerSwap`). Carries
  `Idempotency-Key` (C5.1); driver id resolved from `Principal`. Returns `201 { trailer_assignment_id,
  dropped_trailer_id, created_trailer_id }`.
- **Shared schema**: `TrailerSwapSchema` (matches `api/openapi.yaml`).
- **Compose wiring**: `trailerAssignments` repo + `TrailerService`.
- **Tests**: `TrailerService.swap` unit tests (hook, drop-to-bobtail, external trailer, TRAILER_SWAP
  requirement, drop-photo requirement, double-hook guard) with fakes.

### Notes
- `trailer:swap` is in the seed (DRIVER role), so the route is authorized.
- The licence-plate / drop photos arrive via the not-yet-built presigned-URL media flow (03 §2.7).

## [0.7.0] - 2026-08-06 — Inspections (DVIR) domain

### Added
- **Inspection repositories** (`src/repositories/inspections.ts`): `InspectionRepository`, `InspectionItemRepository`,
  `InspectionItemPhotoRepository`, `InspectionTemplateRepository`, `InspectionTemplateItemRepository`
  (all opt out of soft-delete — no `deleted_at`), `QuarantineRepository` (durable `quarantine_events` + open-asset
  pre-check, C3.9). Added `TrailerRepository` to `repositories/shifts.ts`.
- **Inspection service** (`src/services/inspections.ts`): `InspectionService.submit` (03 §2.5) — inserts the
  inspection + items + photos in one transaction (D8), snapshots each item's template code/label/severity, enforces
  the DB contracts for clean codes: `DEFECTS_NOT_REVIEWED` (C1.6, previous defects acknowledged), `DVIR_FAIL_NEEDS_PHOTO`
  (a FAIL requires a photo, 1.1/1.2), FAIL-requires-notes (08 §5); a BLOCKER failure quarantines the asset +
  marks it non-operational (C1.5) and stages audit + `inspection.submitted` outbox.
- **Inspection route** (`src/http/routes/inspections.ts`): `POST /inspections` (OpenAPI `InspectionSubmit`). Carries
  `Idempotency-Key` (C5.1); driver id resolved from `Principal`. Returns `201 { inspection_id, block_shift }`.
- **Shared schema**: `InspectionSubmitSchema` + `InspectionItemSchema` (matches `api/openapi.yaml`).
- **Compose wiring**: inspection repos + `InspectionService`; `TrailerRepository` added for asset quarantine.
- **Tests**: `InspectionService.submit` unit tests (template-not-found, defects-not-reviewed, DVIR photo/note
  requirements, BLOCKER quarantine + non-operational, no double-quarantine, clean pass) with fakes.

### Notes
- `inspection:submit` is in the seed (DRIVER role), so the route is authorized.
- The failing-item photo rule is a deferred constraint trigger in the DB; the service pre-checks it for the frozen
  `DVIR_FAIL_NEEDS_PHOTO` code (defence in depth, 00 §4). The actual photo bytes arrive via the presigned-URL media
  flow (03 §2.7, not yet implemented).

## [0.6.0] - 2026-08-06 — Accidents domain

### Added
- **Accident repositories** (`src/repositories/accidents.ts`): `AccidentReportRepository` (custom
  `insertReport` builds the `reported_position` geography from the lat/long pair, parameterised),
  `AccidentMediaRepository` (append-only + one-per-report primary-slot pre-check), `EscalationTimerRepository`
  (durable `escalation_timers` row, C6.3).
- **Accident services** (`src/services/accidents.ts`): `AccidentService.mayday` (B17 escape hatch —
  GPS + reason only, `is_mayday=true`, `telemetry_available=false`, fires `accident.escalate` outbox +
  stages the 5-minute escalation timer, 08 §3), `AccidentService.create` (PENDING report; evidence
  follows; `was_off_shift` derived from `shift_id`, `statement_source` from `driver_statement`),
  `AccidentService.attachMedia` (append-only; `DUPLICATE` on a repeated primary slot),
  `AccidentService.acknowledge` (records actor + cancels open escalation timers, C6.3),
  `AccidentQuery.verifyChain` (per-row SHA-256 hash-chain validity via `fn_verify_accident_chain`, C3.4).
- **Accident routes** (`src/http/routes/accidents.ts`): `POST /accidents/mayday`, `POST /accidents`,
  `POST /accidents/{id}/media` (204), `GET /accidents/{id}/telemetry/verify`,
  `POST /accidents/{id}/acknowledge`. Writes carry `Idempotency-Key` (C5.1); reads pooled. Driver id
  resolved from `Principal`.
- **Compose wiring**: accident repos + `AccidentService`/`AccidentQuery`.
- **Shared schema**: `AccidentCreateSchema` (matches `api/openapi.yaml`).
- **Tests**: `AccidentService`/`AccidentQuery` unit tests (mayday escalation, create, media attach,
  acknowledge, verifyChain) with fakes.

### Notes
- `accident:report` (+ `accident:read`/`accident:acknowledge`/`accident:update`/`accident:close`) are
  present in the seed, so routes are authorized for the DRIVER role.
- Telemetry freeze (cloning `location_updates` into `accident_telemetry`) and the actual escalation
  paging are worker responsibilities, triggered by the `accident.escalate` outbox / the durable timer;
  the API only sets `telemetry_available=false` synchronously (N3.2).

## [0.5.0] - 2026-08-06 — Fuel domain

### Added
- **Fuel repositories** (`src/repositories/fuel.ts`): `FuelPurchaseRepository`, `FuelCardRepository`,
  `FuelStatementRepository`.
- **Fuel services** (`src/services/fuel.ts`): `FuelService.submitRefuel` (creates the purchase with its
  mandatory before/after gauge pair per B3, stages audit + `fuel.ocr` outbox for async OCR/anomaly
  scoring, 03 §4), `FuelService.verifyPurchase` (VERIFY / REJECT / CLEAR_PAYMENT with the C6.1 clear-
  after-verify gate), `FuelCardService.create` (pooled XOR assigned-vehicle enforced by DB),
  `ReconciliationService.importStatement` (stores `fuel_card_statements`, queues `reconciliation.statement`
  outbox), `FuelQuery.reconciliationInbox` (keyset cursor over `v_fuel_reconciliation_inbox`, D7).
- **Fuel routes** (`src/http/routes/fuel.ts`): `POST /fuel/refuel`, `POST /fuel/purchases/{id}/verify`,
  `POST /fuel/cards`, `GET /fuel/reconciliation-inbox`, `POST /reconciliation/statements`. Writes carry
  `Idempotency-Key` (C5.1); reads pooled. Driver id resolved from `Principal`.
- **Compose wiring**: fuel repos + `FuelService`/`FuelCardService`/`ReconciliationService`/`FuelQuery`.
- **Tests**: `FuelService` unit tests (submitRefuel + verifyPurchase state machine) with fakes.

### Notes
- Permission `fuel:enter` is used for `/fuel/refuel` but is **not yet in the seed** (same gap class as
  `MANAGE_OWN_MFA`/`REVOKE_DEVICE`) — the route will 403 until the grant exists. `fuel:verify`,
  `fuel:card_manage`, `fuel:reconcile`, `fuel:read` are present in the seed.
- Anomaly scoring (POSSIBLE_THEFT_OR_LEAK, CARD_MISMATCH, EFFICIENCY_DEVIATION, …) is deliberately
  asynchronous; the sync refuel returns `open_anomalies: []` and the worker populates the inbox.

## [0.4.0] - 2026-08-06 — Shifts domain

### Added
- **Shift repositories** (`src/repositories/shifts.ts`): `ShiftRepository` (open/pending lookups),
  `AssignmentRepository`, `VehicleRepository`, `WorkLogRepository`, `FuelRecordRepository`,
  `HosRepository` (reads `driver_hos_state.next_eligible_clock_in_at`).
- **Shift service** (`src/services/shift.ts`): `ShiftService.clockIn` (assignment + odometer +
  GPS-consent + open/pending + HOS checks, inserts `shifts` OPEN + `fuel_records` SHIFT_START,
  stages `audit` + `shift.started` outbox), `clockOut` (odometer/distance/duration, SHIFT_END gauge,
  debrief work-log, `shift.closed` outbox), `verify`/`flag` (VERIFY locks, `UNLOCK_REQUIRED` guard on
  corrected odometer, B18), `forceClose` (admin override, audited), `getActive`. Plus `ShiftQuery.
  verificationInbox` — keyset cursor page over `v_shift_verification_inbox` (D7) with allow-listed
  sort.
- **Shift routes** (`src/http/routes/shifts.ts`): `POST /shifts/clock-in`, `POST /shifts/clock-out`,
  `GET /shifts/me/active`, `GET /shifts/verification-inbox`, `POST /shifts/{id}/verify`,
  `POST /shifts/{id}/force-close`. State-changing routes behind `authenticate` + `requirePermission`
  (`shift:*`) + `idempotency`; reads use a pooled client. Driver id resolved from `Principal` via
  `drivers.user_id`.
- **Compose wiring**: shift repos + `ShiftService`/`ShiftQuery` added to `makeServices`.
- **Tests**: `ShiftService.clockIn` unit tests (7 cases, all 08 §1 error codes + happy path) with
  fakes; full api suite green (14 tests).

### Notes
- `BaseRepository` gained a public `dbClient` accessor for view-backed query services.
- Clock-in inserts `fuel_records` (SHIFT_START) with `start_media_object_id` and defers the
  work-plan photo/notes evidence to clock-out debrief (the deferred `work_logs` plan-evidence
  constraint only fires once a `work_logs` row exists). Residual: wire the dedicated work-plan
  photo at clock-in once the client contract includes it.
- `@fleet/db` rebuilt (dist) so `dbClient` is available to `api`.

## [0.3.0] - 2026-08-06 — Auth domain complete (API vertical slice)

### Added
- **Write path** (`src/http/write.ts`): single `transaction()` per state-changing request (D8);
  idempotency `complete` staged inside the tx; `releaseClaim` frees an IN_PROGRESS claim after a
  transport failure so client retries can re-run. `writeSubject` supports unauthenticated writes
  (login keyed by email).
- **Identity repositories** (`src/repositories/identity.ts`): `UserRepository`, `PermissionRepository`
  (role UNION, N4/C6.2), `DriverRepository`, `SessionRepository`, `DriverDeviceRepository`,
  `ConsentRepository`, `MfaRecoveryCodeRepository` — parameterised SQL only.
- **Auth services** (`src/services/*`):
  - `AuthService` — login (argon2id verify, MFA gate, lockout after `LOGIN_MAX_FAILURES`),
    refresh, logout, logout-all, identity resolver.
  - `SessionService` — token issuance + 10-concurrent-session cap (Redis with DB degrade, R-109).
  - `MfaService` — TOTP enrol/confirm/verify + recovery codes (AES-GCM `SecretBox`, never in clear).
  - `DeviceService` — registration, PIN flag (B12: PIN never stored), device-bound refresh token +
    offline window, revoke, offline PIN counter mirror.
  - `ConsentService` — GDPR consent ledger (append-only, `requireFor` gate).
- **Auth routes** (`src/http/routes/auth.ts`): `/login`, `/mfa/verify`, `/refresh`, `/logout`,
  `/logout-all`, `/mfa/enroll`, `/mfa/confirm`, `/devices`, `/devices/pin`, `/devices/refresh`,
  `/devices/revoke`, `/consent`. State-changing routes behind `authenticate` + `idempotency` (C5.1);
  each handler stages its own `tx.audit`.
- **App composition** (`src/app/compose.ts`, `container.ts`, `app.ts`, `server.ts`): container wiring,
  request-scoped services via `makeServices(tx.client, infra)`, Express app (helmet, json,
  `/healthz`, `/readyz`, `/auth/*`, RFC7807 problem handler), graceful shutdown.
- **Token service** (`src/security/tokens.ts`): added `issueMfaChallenge` / `verifyMfaChallenge`
  (short-lived HS256 challenge). `MFA_CHALLENGE_TTL_SECONDS` added to `env.ts`.
- **Tests**: `AuthService.login` unit tests (6 cases, real argon2id hash) + app `/healthz` smoke test.

### Changed
- `BaseRepository<TRow>` constraint relaxed to `object` (generated `db.ts` row types have no index
  signature) so the repo layer accepts `@fleet/shared` row types. `@fleet/db` tests still green.

### Fixed
- `idempotency` middleware no longer requires a `Principal` (enables unauthenticated `/login`); computes
  subject via `writeSubject` (email fallback).

## [0.2.0] - prior — Data access + schema foundation

- Provisioned live PG on `:5444`; `db/validate.mjs` cross-platform schema/seed validation harness with
  PostGIS shim functions.
- Generated `packages/shared/src/types/db.ts` (44 enums, 68 relations) from live schema.
- `@fleet/db` SQL corrected to match authoritative DDL (`audit_logs`/`outbox_events`/`idempotency_keys`/
  `system_config`); generated `db/types/db.ts` singularisation fix.

## [0.1.0] - prior — Scaffold

- `api`, `worker`, `ws` packages scaffolded (configs, jest, booting entrypoints); `npm run build` +
  `npm run test` green on skeletons.
