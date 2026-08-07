# Execution Prompt — Fleet Management Platform Backend

> **Purpose:** This prompt is the implementation brief for the Fleet Management Platform backend.
> Hand it (with this repo) to an engineer or coding agent to build `@fleet/api`, `@fleet/worker`,
> and `@fleet/ws`. The shared kernel (`@fleet/shared`) and data access layer (`@fleet/db`) are
> **already implemented and tested** — build on them, do not re-implement their contracts.

---

## 1. Goal

Implement the backend services described in the design docs, as a Turborepo monorepo, faithful to
the **locked decisions** and **service boundaries**. The result mustclear
 pass typecheck, contract
checks, and the test suite, and must enforce every cross-cutting invariant below.

## 2. Source of truth (read these first, in order)

- `docs/architecture/00-locked-decisions.md` — every `A*`/`B*`/`C*`/`D*`/`N*`/`M*` decision. **Do not
  contradict these.** When a decision is marked PROVISIONAL (N/M), accept the architect's
  recommendation; do not invent alternatives.
- `docs/architecture/01-service-boundaries.md` — topology, process responsibilities, data ownership.
- `docs/architecture/02-open-risk-register.md` — the 12 resolved risks + residual gates (R-101…R-112).
- `docs/backend/00-overview.md` — monorepo layout, layering contract, OpenAPI→types pipeline.
- `docs/backend/01-shared-kernel.md` — the exact `@fleet/shared` API you must consume.
- `docs/backend/02-auth.md`, `03-rest-api.md` — auth model + REST surface (endpoint→service→repository map).
- `docs/backend/04-telemetry-ingest.md`, `05-workers.md`, `06-repository-migrations.md`,
  `07-websocket-gateway.md`, `08-error-state-model.md`, `09-observability-ci.md` — the remaining subsystems.
- `docs/backend/data-access-layer.md` — how to use `@fleet/db` (`transaction`, `BaseRepository`,
  `PgIdempotencyService`, `PgOutboxRelay`, `PgConfigClient`).

## 3. What already exists (do NOT rebuild)

- `packages/shared` — `Result`, `AppError`/RFC7807, `ConfigClient` types + `CONFIG_DEFAULTS`,
  `transaction`/`Tx`/`PoolLike`/`DbClient` contracts, `IdempotencyService`, `OutboxRelay`,
  `logging` (redaction), `time` (EAT helpers), `Principal`, generated `db.ts` enums/rows, and zod
  `schemas/*`. Built to `dist/`.
- `packages/db` — `createPool`, real `transaction` runner (audit+outbox flushed pre-COMMIT),
  `BaseRepository`, `runMigrations`, `PgIdempotencyService`, `PgOutboxRelay`, `PgConfigClient`.
  Built to `dist/`, 5/5 jest tests passing.
- `db/schema/*.sql` and `db/seed/*.sql` — **authoritative DDL/seed** (apply via `npm run db:validate`
  against the `:5444` cluster; generate `shared/src/types/db.ts` from it with `pg-to-ts`).

## 4. Packages to build

```
packages/
├── api/     # Express HTTP: REST + media presign + webhook accept (command: node dist/api/server.js)
├── worker/  # scheduled + queue jobs + ingest consumer (node dist/worker/index.js --role worker|ingest)
└── ws/      # Socket.IO gateway (node dist/ws/index.js)
```

All three depend on `@fleet/shared` and `@fleet/db` (workspace `*`). Mirror `packages/db/package.json`
for scripts (`build`/`typecheck`/`lint`/`test`/`contract`, `clean`/`rebuild`), `tsconfig.json`
(extends `../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`, `include: ["src/**/*.ts"]`),
and `jest.config.cjs`. Register each new package in the root `turbo.json` automatically via
`workspaces: ["packages/*"]`.

### 4.1 `@fleet/api` structure
```
src/
  server.ts                 # express app, helmet, json, error handler (RFC7807)
  middleware/
    authenticate.ts         # verify HS256 JWT (secret from secret store), attach Principal
    requirePermission.ts    # principal.permissions.has(code) else Forbidden
    idempotency.ts          # Idempotency-Key → IdempotencyService.start; complete in tx
  handlers/                 # THIN: validate(zod) → service → Result→HTTP; no SQL, no rules
    auth.ts shifts.ts fuel.ts accidents.ts inspections.ts trailer.ts
    anomalies.ts documents.ts media.ts dashboard.ts
  services/                 # business rules, invariants, call repos + outbox + idempotency
    AuthService MfaService DeviceService ConsentService SessionService
    ShiftService FuelService AccidentService InspectionService TrailerService
    ReconciliationService + *Query services
  repositories/             # extend BaseRepository; parameterised SQL only
  config/                   # wire PgConfigClient + Redis cache (ConfigClient live client, 01 §7)
  media/                    # MediaService: 60s presigned PUT, Object Lock for ACCIDENT (D5)
  openapi/                  # api/openapi.yaml (single HTTP contract; 00 §5)
```

### 4.2 `@fleet/worker` structure
```
src/
  index.ts                  # argv --role worker|ingest; start jobs / stream consumer
  ingest/consumer.ts        # Redis Stream traccar:positions → retention transform → location_updates
  ingest/backfill.ts        # 5-min Traccar REST poller (30-min lookback, idempotent)
  ingest/derive.ts          # tracker_health, driver_duty_segments, driver_hos_state, movement events
  jobs/                     # the 13 jobs from 05-workers.md §2 (one file each)
  outbox/relay.ts           # PgOutboxRelay.start() + registerHandler per event_type
```

### 4.3 `@fleet/ws` structure
```
src/
  index.ts                  # Socket.IO server, token auth, 10-session cap (Redis)
  channels/map.ts notifications.ts accident.ts   # 07-websocket-gateway.md §3
```

## 5. Implementation phases (build in this order)

1. **Scaffold** `api`, `worker`, `ws` packages (configs, jest, empty `server.ts`/`index.ts` that
   boot and exit 0). Confirm `npm run build` + `npm run test` are green on the skeleton.
2. **Apply DDL + generate types**: run `db/validate.sh`, generate `shared/src/types/db.ts`. Add any
   missing enums referenced by services.
3. **API foundation**: `server.ts`, `authenticate`, `requirePermission`, `idempotency` middleware,
   RFC7807 error handler. Wire `createPool` + `PgConfigClient` + Redis.
4. **Auth domain** (`02-auth.md`): `AuthService`/`MfaService`/`DeviceService`/`ConsentService`/
   `SessionService` + handlers + repositories. This unblocks every other domain (Principal).
5. **Shifts** (`03-rest-api.md` §2.2): `ShiftService` + `ShiftRepository` + handlers, the full
   clock-in flow (§3) including all `error_code`s in `08` §1.
6. **Fuel / Accidents / Inspections / Trailer** handlers+services+repositories per `03` §2.3–2.6.
7. **Media + Dashboard + Anomalies + Documents** queries (`03` §2.7).
8. **Worker**: ingest consumer + backfill + derive; then the 13 jobs; then `PgOutboxRelay` wiring.
9. **WebSocket gateway** (`07`): channels + session cap + snapshot-on-connect.
10. **Observability** (`09`): structured logging already in shared; add Sentry hook, `/healthz`
    `/readyz` `/health/deep`, and the GitHub Actions pipeline + sign-off gate checks.

## 6. Cross-cutting invariants (enforce in review + lint, not just convention)

- **One transaction per write (D8):** every state-changing service method runs inside
  `transaction(pool, fn)`; inside, stage `tx.audit(...)` + `tx.registerOutbox(...)`; never call
  external side effects inline.
- **Idempotency (C5.1/D4):** every state-changing route requires `Idempotency-Key`; replay returns
  the cached response; reuse-with-different-body → `422 IDEMPOTENCY_CONFLICT`; in-flight →
  `409 IDEMPOTENCY_INFLIGHT`.
- **No SQL string concatenation with user input:** repositories use `$1,$2,…` params only; dynamic
  identifiers (sort column, filter key) come from a code allow-list.
- **Soft delete (D3):** repositories set `deleted_at`; never `DELETE` master rows.
- **Append-only tables** (`audit_logs`, `accident_telemetry`, `accident_media`): written only through
  dedicated paths; no update/delete.
- **RFC7807 errors (D7):** handlers serialise `AppError.toProblem()`; `error_code` is the ONLY
  client-branchable member; never invent a code outside the `08` §1 catalogue.
- **Time (A2.3):** store `timestamptz` UTC; use `operationalDate()`/`toEAT()` only at the edge;
  never persist a local-time string.
- **Logging (01 §9):** log via the shared `Logger`; secrets/PII are redacted by construction. Never
  log `system_config.is_sensitive` or tokens in clear.
- **Config (C2.4):** every threshold via `ConfigClient.numeric/string/boolean`; no magic numbers.
- **Handlers stay thin:** no SQL, no business rules, no external calls in handlers.

## 7. Tooling commands

```
npm install                       # install workspace deps
npm run build                     # turbo: tsc -b across packages (dependsOn ^build)
npm run typecheck                 # turbo: tsc -b --noEmit
npm run test                      # turbo: jest (unit + contract)
npm run contract                  # openapi↔schema + db.ts↔schema generation/check
npm run db:validate              # apply db/schema + db/seed to :5444
cd packages/api && npx jest       # per-package tests
```

## 8. Definition of Done (per package)

- `tsc -b` clean (strict, `noUncheckedIndexedAccess`).
- Unit tests ≥ 80 % on services using `Result` + fake repositories (no live DB).
- Integration tests against a throwaway PG asserting real constraints fire (odometer-decrease
  rejection, idempotency replay, DVIR-fail-photo, soft-delete rejection).
- Contract tests: `shared/schemas` match `openapi.yaml`; generated `db.ts` matches live schema.
- Every state-changing endpoint carries `Idempotency-Key`; every write is one transaction with
  staged audit+outbox.
- `08` §1 `error_code` catalogue is the only set returned; state machines in `08` §2–§6 are honoured.

## 9. Hard launch gates (do not skip — see `02-open-risk-register.md` §C)

- **R-101** DPIA approved (Kenya DPA 2019 cross-border transfer; data in `af-south-1`).
- **R-103** HOS figures + emergency numbers confirmed by transport counsel.
- **R-104** DVIR severity matrix reviewed/signed by fleet safety officer.

## 10. First concrete action

Scaffold `@fleet/api` with an empty but booting `server.ts`, get `npm run build` and `npm run test`
green on the skeleton, then implement the `authenticate` + `idempotency` + RFC7807 middleware and
the `AuthService` login flow from `02-auth.md` §2 as the first real vertical slice.
