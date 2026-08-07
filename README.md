# Fleet Management Platform — Backend

A TypeScript/Node.js backend for an African fleet-operations platform (HQ Nairobi, `af-south-1`).
It covers driver auth + MFA, shift/HOS duty cycles, fuel purchasing + reconciliation, accident
mayday + escalation, DVIR inspections, trailer swaps, telemetry ingest from Traccar, anomaly
detection, document expiry, and a real-time Socket.IO gateway.

> **Status — verified green (2026-08-07):**
> - `npm run build` → **5/5 packages compile** (strict `tsc -b`, `noUncheckedIndexedAccess`).
> - `npm run test` → **217 tests passing** across 32 suites (shared 43, db 6, worker 28, ws 17, api 123); the suite exits **clean with no open-handle warnings**.
> - `npm run contract` → OpenAPI↔zod and DDL↔`db.ts` checks wired per package.

---

## 1. Architecture at a glance

**Turborepo monorepo**, four runtime processes sharing one Postgres + Redis, wired through two
internal libraries (`@fleet/shared`, `@fleet/db`).

```
                         ┌─────────────── HTTP / REST ───────────────┐
   Mobile / Admin  ─────▶│  @fleet/api  (Express, :8080)             │
   Traccar webhook ─────▶│  POST /api/v1/telemetry/webhook (public)  │
                         └───────────┬───────────────────┬──────────┘
                                     │ pool / redis       │ pool / redis
                          ┌──────────▼─────────┐   ┌──────▼──────────────┐
                          │  @fleet/worker      │   │  @fleet/ws          │
                          │  (jobs + ingest)    │   │  (Socket.IO, :8081) │
                          └──────────┬─────────┘   └──────┬──────────────┘
                                     │ outbox + pub/sub    │ redis pub/sub
                                     ▼                     ▼
                          ┌──────────────── PostgreSQL 16 + PostGIS ────────────────┐
                          │  schema 00–11 (extensions, enums, identity, assets,      │
                          │  operations, telemetry/HOS, financial, safety, …)        │
                          └──────────────────────────────────────────────────────────┘
                                     ▲
                          ┌──────────┴──────────┐
                          │ @fleet/shared (types,│  @fleet/db (pool, transaction,
                          │  errors, schemas,    │   repos, idempotency, outbox,
                          │  config, logging)    │   config client, migrations)
                          └─────────────────────┘
```

### Runtime processes

| Process | Command | Responsibility | Talks to |
|---|---|---|---|
| `api` | `node dist/api/server.js` | REST + media presign + Traccar webhook accept | PG, Redis (cache/sessions/idempotency/outbox), S3, FCM, Africa's Talking, Google Vision |
| `worker` | `node dist/worker/index.js --role worker` | scheduled + outbox-driven jobs | PG, Redis, Traccar REST, Google Vision, FCM, Africa's Talking, S3 |
| `ingest` | `node dist/worker/index.js --role ingest` | Traccar telemetry consumer + back-fill poller | Redis Stream, PG, Traccar REST |
| `ws` | `node dist/ws/index.js` | Socket.IO gateway (no system of record) | Redis (pub/sub + session hash), PG (read-only) |

`worker` and `ingest` are the **same image** started with a `--role` switch.

### Layering contract (mandatory)

```
HTTP → express router (zod-validate) → authn/authz middleware (attach Principal)
     → handler (THIN: request→service, Result→HTTP) → service (rules/invariants)
     → repository (parameterised SQL) → PostgreSQL  (inside ONE transaction per write, D8)
```

---

## 2. Packages

### `@fleet/shared` (`packages/shared`) — the kernel
Zero-dependency types/utilities imported by every other package and the mobile/admin apps.
- `result.ts` — `Result<E>` (instead of throwing across boundaries).
- `errors.ts` — `AppError` hierarchy + RFC7807 (`application/problem+json`) serialisation;
  `error_code` is the **only** client-branchable member.
- `config.ts` — `ConfigClient` interface + `CONFIG_DEFAULTS` (mirror of the `system_config` seed).
- `transaction.ts` — `Tx` / `PoolLike` / `DbClient` contracts.
- `idempotency.ts`, `outbox.ts` — `IdempotencyService` / `OutboxRelay` contracts.
- `logging.ts` — structured logger with **secret/PII redaction by construction**.
- `time.ts` — EAT helpers (`operationalDate`, `toEAT`); DB is always UTC (A2.3).
- `types/db.ts` — **generated** row/enums from the DDL (`npm run db:types`).
- `schemas/*` — zod validators mirroring the OpenAPI request/response bodies.
- `realtime.ts`, `telemetry.ts`, `ingest.ts`, `types/principal.ts` — shared domain + wire types.

### `@fleet/db` (`packages/db`) — data access
- `createPool` — `pg` pool wrapper (`FleetPool`).
- `transaction` — real runner; **audit log + outbox are flushed pre-COMMIT** (D8).
- `BaseRepository` — parameterised-SQL base for all repositories.
- `runMigrations`, `PgIdempotencyService`, `PgOutboxRelay`, `PgConfigClient`.
- 6 tests covering real transaction/audit/outbox/idempotency behaviour.

### `@fleet/api` (`packages/api`) — the HTTP service
Boot order: `server.ts` → `buildContainer()` (pool, Redis, `PgConfigClient`,
`PgIdempotencyService`, token signer, AES-GCM box, S3 presigner) → `createApp()` (Express).

**Routes** (under `API_BASE_PATH`, default `/api/v1`):

| Mount | Router | Domain |
|---|---|---|
| `/auth` | `auth.ts` | login, MFA/TOTP, device PIN, consent, session |
| `/shifts` | `shifts.ts` | clock-in/out, verify, force-close, active, verification inbox |
| `/fuel` | `fuel.ts` | submit refuel, verify purchase, create, reconciliation inbox |
| `/reconciliation` | `reconciliation.ts` | statement import + matching |
| `/accidents` | `accidents.ts` | mayday, create, attach media, acknowledge, verify chain |
| `/inspections` | `inspections.ts` | DVIR submit + review |
| `/trailer` | `trailer.ts` | trailer swap |
| `/media` | `media.ts` | S3 presigned PUT (60 s; Object-Locked accident bucket) |
| `/anomalies`, `/documents/expiring`, `/dashboard/vehicle-states` | `insights.ts` | read-only queries (anomalies feed, expiring docs, live map snapshot) |
| `/telemetry/webhook` | `telemetry.ts` | **public** Traccar webhook accept (front of ingest) |
| `/healthz`, `/readyz`, `/health/deep` | `health.ts` | probes (outside auth) |

**Services** (business rules + invariants; request-scoped in `app/compose.ts`):

| Domain | Services |
|---|---|
| Identity/Security | `AuthService`, `MfaService`, `DeviceService`, `ConsentService`, `SessionService` |
| Shifts/HOS | `ShiftService`, `ShiftQuery` |
| Fuel | `FuelService`, `FuelCardService`, `ReconciliationService`, `FuelQuery` |
| Accidents | `AccidentService`, `AccidentQuery` |
| Inspections | `InspectionService` |
| Trailer | `TrailerService` |
| Media | `MediaService` |
| Insights | `AnomalyQuery`, `DocumentQuery`, `DashboardQuery` |

**Repositories** (extend `BaseRepository`, parameterised SQL only): identity (User,
Permission, Driver, Session, DriverDevice, Consent, MfaRecoveryCode); shifts (Assignment,
FuelRecord, Hos, Shift, Vehicle, WorkLog); inspections (Inspection, InspectionItem,
InspectionItemPhoto, InspectionTemplate, InspectionTemplateItem, Quarantine); fuel
(FuelCard, FuelPurchase, FuelStatement); accidents (AccidentReport, AccidentMedia,
EscalationTimer); trailer (Trailer, TrailerAssignment); media (MediaObject).

### `@fleet/worker` (`packages/worker`) — jobs + ingest
- **Ingest** (`--role ingest`): `IngestConsumer` (Redis Stream `traccar:positions` →
  `location_updates`), `BackfillPoller` (5-min Traccar REST poll, 30-min lookback, idempotent),
  `derive` (tracker_health, driver_duty_segments, driver_hos_state, movement events).
- **Outbox relay**: `PgOutboxRelay` drains `app.outbox_events`; handlers are idempotent and
  funnel **all** external side effects here so request transactions never call outside services.
- **13 jobs** — scheduled (`buildSchedule`) + outbox-driven:

  | Job | Cadence / Trigger | Purpose |
  |---|---|---|
  | `notifications` | 5 s | drain notification queue → FCM/SMS/email (quiet-hours aware) |
  | `escalation` | 60 s | accident/on-call tier escalation timers |
  | `hos-recompute` | 5 min | driver HOS state recompute |
  | `fuel-anomaly` | 5 min | gauge/efficiency/price outlier detection |
  | `ocr` | 30 s / `fuel.ocr` | Google Vision fuel-receipt OCR |
  | `maintenance-eval` | 1 h | maintenance due evaluation |
  | `stale-shift` | 1 h | auto-close stuck shifts |
  | `document-expiry` | 1 d | flag expiring asset documents |
  | `efficiency-baseline` | 1 d | rolling efficiency baselines |
  | `partition-maint` | 1 d | telemetry/HOS partition maintenance |
  | `retention` | 1 d (dry-run) | data-retention enforcement (D6) |
  | `accident-freeze` | `accident.escalate` | freeze evidence + page on-call |
  | `reconciliation` | `reconciliation.statement` | match statement lines to purchases |

### `@fleet/ws` (`packages/ws`) — real-time gateway
- Socket.IO server; **token auth** (shares JWT key with `api`), **10-session cap per user** (Redis).
- Holds **no system of record** — recomputes from `vehicle:{id}:state` Redis hash + PG read views,
  pushes `vehicleStates` / `notifications` / `accident` channels, snapshot-on-connect.
- Event bus is Redis pub/sub in prod, in-memory in dev.

---

## 3. Data model

- **Authoritative DDL**: `db/schema/00_extensions.sql` → `11_views.sql` (extensions, enums,
  platform_core, identity, assets, operations, telemetry_hos, financial, safety, audit/notifications,
  partitions, views). Row types in `packages/shared/src/types/db.ts` are **generated** from this
  (`npm run db:types`) — never hand-maintained.
- **Seed**: `db/seed/*.sql` (incl. `system_config` defaults mirrored by `CONFIG_DEFAULTS`).
- **Append-only tables** (`audit_logs`, `accident_telemetry`, `accident_media`): written only
  through dedicated paths. **Soft delete** (`deleted_at`) everywhere else — never `DELETE` master rows.

---

## 4. Cross-cutting invariants (enforced in review + lint)

1. **No SQL string concatenation with user input** — `$1,$2,…` params only; dynamic identifiers
   come from an allow-list.
2. **One transaction per write (D8)** — mutation + staged audit + staged outbox; side effects drained
   by the worker outbox relay, never called inline.
3. **Idempotency (C5.1/D4)** — every state-changing route requires `Idempotency-Key`; replay returns
   the stored response; reuse-with-different-body → `422 IDEMPOTENCY_CONFLICT`; in-flight → `409`.
4. **Soft delete (D3)** + **append-only** enforcement at the DB.
5. **RFC7807 errors (D7)** — handlers serialise `AppError.toProblem()`; `error_code` is the only
   client branch point, drawn from the catalog in `docs/backend/08-error-state-model.md`.
6. **Time (A2.3)** — `timestamptz` UTC in DB; `operationalDate()`/`toEAT()` only at the edge.
7. **Logging (01 §9)** — via shared `Logger`; secrets/PII redacted by construction; never log
   `system_config.is_sensitive` or tokens in clear.
8. **Config (C2.4)** — every threshold via `ConfigClient.numeric/string/boolean`; no magic numbers.
9. **Handlers stay thin** — no SQL, rules, or external calls in handlers.

---

## 5. Auth, security & observability

### Authentication & sessions
- HS256 JWT access tokens (15 min) + refresh tokens (7 d); **current + previous key** for a 24 h
  rotation overlap (`JWT_SECRET` / `JWT_SECRET_PREVIOUS`, `JWT_KID`).
- MFA/TOTP with AES-GCM-encrypted shared secret (`MFA_ENCRYPTION_KEY`); recovery codes.
- Device PIN + revocation + offline support (`DeviceService`).
- Permission **union** resolution (`PermissionService`); `requirePermission` middleware.
- Login throttling (`LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`).
- argon2id password hashing; 10-session cap per user; idempotency (`Idempotency-Key`) on every
  state-changing route (D4/C5.1).

### Edge / abuse protection (security.md S-1 / S-3)
Enforced in `packages/api/src/security/*`, gated by `SECURITY_ENFORCE` (`always` | `production` |
`off`; default `production` → only when `NODE_ENV=production`). `always` is used by the test suite so
the controls are always exercised. Health probes are excluded.

- **Rate limiting** (`rateLimit.ts`): per-IP, per-scope sliding/fixed-window counters — global,
  `auth`, `media`, and `telemetry` scopes, each with its own per-minute cap (`RATE_LIMIT_*_PER_MINUTE`).
  Redis-backed in production, in-memory fallback when Redis is unavailable (degrades open, never blocks).
- **IP auto-blocking** (`ipBlock.ts`): counts abusive responses (`401`/`403`/`429`) per IP in a sliding
  window; once `IP_BLOCK_THRESHOLD` is exceeded the IP is blocked (`403 IP_BLOCKED`) for
  `IP_BLOCK_TTL_SECONDS`. Manual blocklist supported.
- **Telemetry webhook HMAC (S-1)** (`webhookAuth.ts`): when `WEBHOOK_SECRET` is set, the public
  `POST /api/v1/telemetry/webhook` requires an `X-Signature` HMAC-SHA256 over the raw body plus an
  `X-Timestamp` within a ±5 min skew window; mismatch → `401`. Without a secret it is a pass-through
  and logs a warning (never silently "secure").
- **Safe JSON body parsing** (`bodyParser.ts`): enforces `application/json` content-type, stashes the
  raw bytes for HMAC verification, rejects prototype-pollution keys (`__proto__`/`constructor`/
  `prototype`), and rejects payloads nested deeper than 10 levels.
- **Security headers** (`headers.ts` + `helmet`): `Content-Security-Policy` (`default-src 'none'`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, etc.
- **CORS** via an explicit allow-list (`ALLOWED_ORIGINS`); the `ws` gateway uses `cors:{origin:false}`.

### Observability (C5.7)
- **Structured JSON logs** via the shared `Logger`; secrets/PII are redacted by the kernel serializer
  before emission (never logged in clear).
- **Error reporting → Sentry**: `initErrorReporter(cfg)` (no-op without a DSN) wires `reportError`,
  which tags every `AppError`/uncaught exception with `error_code`, `requestId`, and `principalId`
  (no PII). `flushTelemetry()` drains before exit.
- **In-process metrics** (`Metrics` + `consoleMetricSink`) for request/error counters, emitted as
  structured log lines (CloudWatch in AWS).
- **`requestId` correlation**: generated per request and threaded into `AppError` and the RFC7807
  `instance`, so a single operation is traceable across API → outbox → worker.

---

## 6. Configuration & environment

Real secrets (JWT key, S3/KMS, DB/Redis URLs, FCM, Africa's Talking, Google Vision) are mounted
from the platform secret store. `system_config` holds only tunable thresholds. Key variables:

| Package | Key variables |
|---|---|
| api | `PORT`, `API_BASE_PATH`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET[_PREVIOUS]`, `JWT_KID[_PREVIOUS]`, `MFA_ENCRYPTION_KEY`, `AWS_*`/S3 buckets, `LOGIN_*`, `SENTRY_*` |
| worker | `ROLE`, `DATABASE_URL`, `REDIS_URL`, `TRACCAR_*`, `FCM_SERVER_KEY`, `AFRICAS_TALKING_*`, `OUTBOX_*`, `HEALTH_PORT` |
| ws | `WS_PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET[_PREVIOUS]`, `JWT_KID[_PREVIOUS]` |

All env is schema-validated (`zod`) in each package's `config/env.ts`; an invalid config throws at boot.

**Edge/abuse-protection env** (api): `SECURITY_ENFORCE` (`always`/`production`/`off`), `TRUST_PROXY`,
`WEBHOOK_SECRET` (telemetry HMAC), `ALLOWED_ORIGINS` (CORS allow-list),
`RATE_LIMIT_GLOBAL_PER_MINUTE` / `RATE_LIMIT_AUTH_PER_MINUTE` / `RATE_LIMIT_MEDIA_PER_MINUTE` /
`RATE_LIMIT_TELEMETRY_PER_MINUTE`, and `IP_BLOCK_THRESHOLD` / `IP_BLOCK_WINDOW_SECONDS` /
`IP_BLOCK_TTL_SECONDS`.

---

## 7. Testing

| Command | What it runs |
|---|---|
| `npm run test` | turbo `jest` across all packages — **217 passing (32 suites)** |
| `npm run build` | `tsc -b` strict build of all packages |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run contract` | OpenAPI↔zod + DDL↔`db.ts` generation/checks |
| `npm run db:validate` | apply `db/schema` + `db/seed` to the `:5444` cluster |
| `npm run db:validate:bash` | same, via `db/validate.sh` |
| `npm run db:types` | regenerate `shared/src/types/db.ts` from the live schema |
| `npm run db:types:check` | verify generated `db.ts` matches the live schema (no write) |
| `cd packages/api && npx jest` | per-package tests |

Unit tests use `Result` + **fake repositories** (no live DB). Coverage targets ≥ 80 % on services.

> **Clean teardown:** each package runs jest with `maxWorkers: 1` (single process). Turbo still runs
> the five packages in parallel, but as five processes instead of dozens of worker children, so the
> suite exits gracefully with **no open-handle warnings** — and without CPU saturation.

---

## 8. Build & run (local)

```bash
npm install                       # workspace deps
npm run db:validate               # stand up :5444 PG (DDL + seed)
npm run db:types                  # generate shared/src/types/db.ts
npm run build                     # compile all packages
npm run test                      # run the full suite

# Processes (need DATABASE_URL / REDIS_URL pointing at the :5444 cluster + :6379)
node dist/api/server.js
node dist/worker/index.js --role worker
node dist/worker/index.js --role ingest
node dist/ws/index.js
```

---

## 9. Deployment

- `deploy/Dockerfile` — single image for `api`/`worker`/`ingest`/`ws` (command switch).
- `deploy/docker-compose.yml` — local full stack (api, worker, ws, ingest, postgres, redis, traccar).
- `deploy/k8s/manifests.yaml` — k8s Deployments (extend with an `ingest` Deployment reusing the
  worker image + `--role ingest`).
- Secrets reference `fleet-secrets`, `fleet-db`, `fleet-redis` (provisioned by IaC, not committed).

---

## 10. API contract

The single HTTP contract is `api/openapi.yaml`. It is the source of truth for
`shared/src/types/api.ts` (generated) and `shared/src/schemas/*` (zod runtime guards); any drift
fails the `contract` task. The mobile app and admin web consume `@fleet/shared` so all three share
identical request/response shapes.

---

## 11. Source of truth / design docs

`docs/architecture/*` (locked decisions, service boundaries, risk register) and `docs/backend/*`
(overview, shared kernel, auth, REST, ingest, workers, migrations, websocket, error model,
observability) describe the contracts this implementation satisfies. The implementation brief is
`docs/backend/IMPLEMENTATION-PROMPT.md`.
