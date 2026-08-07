# Backend Design 00 — Overview & Service Module Map

**Status:** Design . **Source of truth:** `docs/architecture/00-locked-decisions.md`,
`01-service-boundaries.md`, `api/openapi.yaml`, `db/schema/*`.
**Stack lock:** Node.js 20 + Express + TypeScript (A3.1), Traccar ingest (A1.1), Redis Stream
(N2.3), PostgreSQL 16 + PostGIS (C5.9), S3 + Object Lock (D5), FCM direct (N9), Africa's Talking
(A1.8), Socket.IO (A1.6), Turborepo monorepo (A3.8).

---

## 1. Purpose of this document

This is the entry point for the backend design. It defines:

1. The monorepo layout and package boundaries.
2. The runtime processes (`api`, `worker`, `ws`, `ingest`) and how they share code.
3. The layering contract every module obeys (handler → service → repository → db).
4. How the OpenAPI contract becomes compile-time types.
5. The non-negotiable cross-cutting invariants that every later document assumes.

Documents `01`–`09` expand each subsystem. Nothing here is implemented; this is the
contract the implementation must satisfy.

---

## 2. Monorepo layout (Turborepo, A3.8)

```
fleet-management/
├── package.json                 # workspaces + turbo pipeline
├── turbo.json                   # task graph: build / lint / typecheck / test / contract
├── tsconfig.base.json
├── packages/
│   ├── shared/                  # types, schemas, errors, utils (built, imported by all)
│   │   ├── src/
│   │   │   ├── types/           # generated OpenAPI types + domain types
│   │   │   ├── schemas/         # zod request/response validators (single source w/ OpenAPI)
│   │   │   ├── errors.ts        # AppError hierarchy + RFC7807 mapping
│   │   │   ├── config.ts        # typed system_config keys + defaults (mirror db seed)
│   │   │   ├── time.ts          # EAT helpers (A2.3)
│   │   │   └── result.ts        # Result<E> type
│   │   └── package.json         # @fleet/shared
│   ├── db/                      # migration runner + query helpers (NOT an ORM by default)
│   │   └── package.json         # @fleet/db
│   ├── api/                     # the Express HTTP service (REST + media presign + webhook)
│   │   └── package.json         # @fleet/api
│   ├── worker/                  # all background jobs + the ingest consumer
│   │   └── package.json         # @fleet/worker
│   ├── ws/                      # Socket.IO gateway (separate process, shares api code)
│   │   └── package.json         # @fleet/ws
│   └── mobile/                  # Expo app (A3.4) — consumes @fleet/shared types
│       └── admin-web/           # binds externally-supplied UI (A3.6)
└── deploy/                      # Dockerfile, k8s, docker-compose (already delivered)
```

**Rules:**
- `shared` has **zero runtime deps** on `api`/`worker` and must never import a database
  client. It is published as a built package so mobile/admin can consume identical types.
- `api`, `worker`, `ws` all depend on `shared` and `db`. `worker` and `ingest` are the same
  image (`deploy/Dockerfile`) with a command switch: `worker` runs cron/scheduled jobs and
  the ingest consumer; `api` runs HTTP; `ws` runs Socket.IO.
- The DDL in `db/schema` is the authority for table shape. TypeScript row types are
  **generated** from it (see §5), never hand-maintained.

---

## 3. Runtime processes and their boundaries

| Process | Command | Responsibility | Talks to |
|---|---|---|---|
| `api` | `node dist/api/server.js` | REST + media presign + Traccar webhook accept | PG, Redis (cache/sessions/idempotency/outbox), S3, FCM, Africa's Talking, Google Vision |
| `worker` | `node dist/worker/index.js` | scheduled + queue jobs, ingest consumer, back-fill poller | PG, Redis (Stream + outbox), Traccar REST, Google Vision, FCM, Africa's Talking, S3 |
| `ws` | `node dist/ws/index.js` | Socket.IO gateway | Redis (pub/sub + per-user session hash), PG (read-only for state) |
| `ingest` | (mode of `worker`) | consumes `traccar:positions` Redis Stream | Redis Stream, PG, Traccar REST (back-fill) |

Why `ws` is separate: Socket.IO needs its own connection/heartbeat management and a
different scaling profile than request/response HTTP (A1.6). It holds **no system of
record** — it recomputes state from PG + the `vehicle:{id}:state` Redis hash and pushes
`app.v_vehicle_display_state` (N5).

Why `ingest` is a worker mode: it is a long-running consumer, not a cron job, so it lives
with the worker image but is started as its own Deployment in k8s (`deploy/k8s/manifests.yaml`
can be extended with an `ingest` Deployment reusing the worker image and a `--role ingest`
flag).

---

## 4. Layering contract (mandatory)

Every request path obeys:

```
HTTP request
  → express router (parses, validates with zod schema from shared/schemas)
  → authn/authz middleware (attaches Principal: userId, roles[], permissions[], deviceId?)
  → handler (thin: maps request → service call, maps Result → HTTP response)
  → service (business rules, invariants, calls repositories + outbox + idempotency)
  → repository (parameterised SQL via db pool; NO business logic)
  → PostgreSQL (+ PostGIS)  ← inside ONE transaction per state-changing call (D8)
```

**Invariants (enforced by review + lint, not just convention):**
1. **No SQL string concatenation with user input.** Repositories use parameterised queries
   only. Dynamic identifiers (e.g. `sort` column) come from an allow-list.
2. **One transaction per write (D8).** A state-changing service method opens a transaction
   that wraps: domain mutation + `audit_logs` insert (via interceptor) + `outbox_events`
   insert. Side effects (push/SMS/escalation) are **never** called inline; they are drained
   from `outbox_events` by the worker.
3. **Idempotency (C5.1/D4).** Every state-changing handler reads `Idempotency-Key`. The
   service checks `app.idempotency_keys` inside the transaction; on replay returns the stored
   response, on key-reuse-with-different-body returns `422 IDEMPOTENCY_CONFLICT`.
4. **Soft delete (D3).** Repositories set `deleted_at`; they never `DELETE` from master rows.
   Hard delete triggers raise `restrict_violation` at the DB (already in DDL).
5. **Append-only tables** (`audit_logs`, `accident_telemetry`, `accident_media`) are written
   by services through dedicated paths; no update/delete is attempted.
6. **No secrets in logs.** `system_config.is_sensitive` and any PII are redacted by the
   logging serializer.
7. **Time is UTC in the DB, EAT at the edge (A2.3).** Services store `timestamptz`; they never
   store a local-time string. `operational_date` is a generated column in PG.

---

## 5. OpenAPI → types pipeline

`api/openapi.yaml` is the single contract for the HTTP surface. The build pipeline:

1. `openapi-typescript` generates `shared/src/types/api.ts` (request/response interfaces).
2. `shared/src/schemas/*.ts` contains **zod** validators that mirror each request body and
   query. These are the runtime guards; the OpenAPI document is the spec. Disagreement
   between the two is a CI failure (`contract` task).
3. The frontend teams (mobile/admin) import `@fleet/shared` so the driver app, admin web and
   backend share one type definition — the externally-supplied UI designs (A3.6) bind to these
   exact shapes.
4. Row types for the DB are generated from the DDL via `pg-to-ts` (or `typegen`) against a
   running Postgres (the one we just stood up on `:5444`), producing `shared/src/types/db.ts`.
   This keeps TypeScript honest about columns, enums, and generated columns.

This is why the DDL validation we ran matters: `db/types` generation depends on a live,
applied schema.

---

## 6. Configuration & secrets

`system_config` (table) holds **every tunable threshold** (C2.4). The service layer reads it
through `ConfigClient`, which:
- caches the row in Redis with a short TTL (e.g. 30 s),
- falls back to the seeded default when the row is absent,
- writes through on admin change (invalidates cache + writes `audit_logs` via interceptor).

**Out of band (real secrets, never in `system_config`):** JWT signing key, FCM service-account
JSON, Google Vision key, Africa's Talking API key, S3 credentials/KMS, DB/Redis URLs. These
come from the platform secret store (EKS IRSA / SSM) and are mounted as env/secret files. The
`deploy/k8s/manifests.yaml` references `fleet-secrets`, `fleet-db`, `fleet-redis` — those are
provisioned by IaC, not committed.

---

## 7. Error model (summary; full in `08`)

All errors are `AppError` subclasses carrying `{ httpStatus, error_code, title, detail? }`.
Handlers serialise to RFC7807 (`application/problem+json`) with the `error_code` extension
member. `error_code` is a **stable** string (e.g. `CLOCKOUT_PENDING`, `HOS_REST_BLOCKED`,
`ACCOUNT_SUSPENDED`, `IDEMPOTENCY_CONFLICT`, `ODOMETER_DECREASED`) so the mobile app can branch
on it. Domain error codes are listed in `08`; the HTTP status mapping is in `api/openapi.yaml`
responses.

---

## 8. Testing contract (summary; full in `09`)

Per A3.3 / C5.8:
- **Unit** ≥ 80% on services (use `Result` + fakes for repos).
- **Integration** against a throwaway PG (the `db/validate.sh` cluster pattern) with applied
  DDL + seed, asserting real constraints/triggers fire (e.g. odometer-decrease rejection,
  idempotency replay, DVIR-fail-photo enforcement).
- **Contract** tests assert `shared/schemas` match `openapi.yaml`.
- **E2E** Playwright on critical journeys (clock-in → refuel → verify; accident mayday →
  escalation).
- **Load** 50 trackers × 10 s against the ingest path (C5.8).

These gates run in GitHub Actions (`09`) before any merge to `staging`.

---

## 9. What the later documents add

| Doc | Expands |
|---|---|
| `01` | `shared` kernel internals: `Result`, `AppError`/RFC7807, `IdempotencyService`, `Transaction`, `OutboxRelay`, `ConfigClient`, `MediaPresigner`, logging, `time`. |
| `02-auth.md` | Auth: JWT, MFA/TOTP, `PermissionService` (union), `DeviceService` (PIN/revocation/offline), session cap. |
| `03` | REST handlers per domain, validation, pagination, offline queue, error matrix. |
| `04` | Telemetry ingest (Redis Stream, retention transform, back-fill, duty/HOS inference). |
| `05` | Workers (all 13 jobs) with triggers, inputs, outputs, idempotency. |
| `06` | Repository pattern, migrations, soft-delete/append-only enforcement, partition access. |
| `07` | Socket.IO gateway channels, push flow, session cap. |
| `08` | Error/state model: full error catalog + shift/accident/HOS/anomaly state machines. |
| `09` | Observability (CloudWatch/Sentry), probes, GitHub Actions pipeline. |
