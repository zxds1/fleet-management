# Backend Design 01 — Shared Kernel (`@fleet/shared`)

**Status:** Implemented (v1.0). **Depends on:** `00-overview.md`, `docs/architecture/00-locked-decisions.md`,
`db/schema/*`, `db/seed/01_seed.sql`, `api/openapi.yaml`.

This document is the authoritative specification of the **shared kernel** package
(`packages/shared`, published as `@fleet/shared`). It is the only package every other
process imports for types, errors, schemas, and cross-cutting primitives (A3.8). The
code in `packages/shared/src/**` is the source of truth; this document describes its
contracts, invariants, and intended usage.

Cross-references from `00`/`02`/`03` resolve here:
`01 §2` = error model, `01 §4` = transaction primitive, `01 §5` = idempotency,
`01 §9` = logging redaction, `01 §11` = validation mapping.

---

## 1. Purpose & package layout

`@fleet/shared` carries **zero runtime dependency on `api`/`worker`/`ws` and never imports a
database client** (rule from `00` §2). It is built (`tsc -b`) into `dist/` and consumed as a
compiled package so mobile (Expo) and admin-web bind to identical shapes (A3.4, A3.6).

```
packages/shared/src/
├── index.ts            # public barrel — single import surface for all consumers
├── result.ts           # Result<T,E>, ok/err, isOk/isErr
├── errors.ts           # AppError hierarchy + RFC7807 serialisation
├── config.ts           # typed system_config keys (C2.4) + CONFIG_DEFAULTS
├── transaction.ts      # Tx, PoolLike, transaction() contract (D8)
├── idempotency.ts      # IdempotencyService contract (C5.1/D4)
├── outbox.ts           # OutboxRelay contract (D8)
├── logging.ts          # structured JSON logger + PII/secret redaction
├── time.ts             # EAT helpers (A2.3)
├── types/
│   ├── principal.ts    # Principal (attached by auth middleware, 02 §1)
│   └── db.ts           # domain enums + row types (generated from DDL, 00 §5)
└── schemas/            # zod request validators mirroring openapi.yaml (00 §5)
    ├── auth.ts
    ├── shifts.ts
    ├── fuel.ts
    └── accidents.ts
```

All consumers import from the barrel:

```ts
import { ok, err, AppError, transaction, Principal, ClockInSchema } from "@fleet/shared";
```

---

## 2. Error model — `AppError` + RFC7807 (`01 §2`)

Every error a service can return is an `AppError` subclass. The **only** member clients
branch on is `error_code` (a stable string such as `ODOMETER_DECREASED`). Handlers serialise
via `toProblem()` to `application/problem+json` (D7), extended with the `error_code` member
and optional `field_errors`.

```ts
abstract class AppError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly error_code: string;
  readonly title: string;
  readonly detail?: string;
  readonly field_errors?: FieldError[];
  readonly cause?: unknown;
  readonly requestId?: string;
  toProblem(): RFC7807Problem;
}

interface RFC7807Problem {
  type: string;        // https://docs.fleet.internal/problems/<error_code lowercased>
  title: string;
  status: number;
  detail?: string;
  instance?: string;   // = requestId
  error_code: string;  // STABLE — client switch key
  field_errors?: FieldError[];
}
```

**Concrete subclasses (frozen catalogue):**

| Class | HTTP | `error_code` | Raised for |
|---|---|---|---|
| `ValidationError` | 400 | `VALIDATION_ERROR` | zod failure (with `field_errors`) |
| `Unauthenticated` | 401 | `UNAUTHENTICATED` | missing/invalid access token |
| `MfaRequired` | 401 | `MFA_REQUIRED` | MFA code required (02 §2) |
| `Forbidden` | 403 | `FORBIDDEN` | missing permission |
| `AccountSuspended` | 403 | `ACCOUNT_SUSPENDED` | suspended driver at sync (B13) |
| `DeviceRevoked` | 403 | `DEVICE_REVOKED` | revoked device (B12) |
| `ConsentRequired` | 403 | `CONSENT_REQUIRED` | missing GPS consent (C5.5) |
| `NotFound` | 404 | `NOT_FOUND` | missing resource |
| `ConflictError` | 409 | *dynamic* | domain conflict (e.g. `CLOCKOUT_PENDING`) |
| `SemanticViolation` | 422 | *dynamic* | semantic rule (e.g. `ODOMETER_DECREASED`) |
| `IdempotencyConflict` | 422 | `IDEMPOTENCY_CONFLICT` | key reused, body differs (C5.1) |
| `IdempotencyInFlight` | 409 | `IDEMPOTENCY_INFLIGHT` | prior attempt not finished |
| `RateLimited` | 429 | `RATE_LIMITED` | too many attempts (M4) |
| `ServiceUnavailable` | 503 | `SERVICE_UNAVAILABLE` | downstream degraded (Traccar/Vision/FCM) |

Domain-specific 409/422 codes (`CLOCKOUT_PENDING`, `ODOMETER_DECREASED`, `HOS_REST_BLOCKED`,
`MISSING_GAUGE_PAIR`, `DVIR_FAIL_NEEDS_PHOTO`, `UNLOCK_REQUIRED`, `NO_ASSIGNMENT`, …) travel as
the `error_code` of `ConflictError` / `SemanticViolation`, constructed with the helpers:

```ts
conflict("CLOCKOUT_PENDING", "Shift pending close-out", "Close out the open shift first");
violation("ODOMETER_DECREASED", "Odometer cannot decrease", "start_odometer_km < current", [
  { field: "start_odometer_km", code: "ODOMETER_DECREASED", message: "…" },
]);
```

`TransactionError` (`TRANSACTION_FAILED`, 500) is raised by the kernel if `transaction()` is
invoked without a bound runner (see §4). The full client-visible catalogue and state machines
are in `08-error-state-model.md`.

---

## 3. `Result<T, E>`

Every **service** method returns `Result<T>` (never throws for expected failures). `E` defaults
to `AppError`. Handlers switch on `isOk`/`isErr` to map to HTTP (§2).

```ts
type Ok<T>     = { ok: true;  value: T };
type Err<E>    = { ok: false; error: E };
type Result<T, E = AppError> = Ok<T> | Err<E>;

const ok  = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = <E extends AppError>(error: E): Err<E> => ({ ok: false, error });
function isOk<T, E>(r: Result<T, E>): r is Ok<T>;
function isErr<T, E>(r: Result<T, E>): r is Err<E>;
```

Usage:

```ts
function clockIn(tx: Tx, body: ClockInInput): Result<ShiftRow, AppError> {
  if (body.start_odometer_km < current) return err(violation("ODOMETER_DECREASED", "…"));
  const shift = repos.shifts.insert(/* … */);
  return ok(shift);
}
```

Repositories and the transaction runner may throw (transport failure) — those are caught at the
handler boundary and mapped to `SERVICE_UNAVAILABLE` / `TRANSACTION_FAILED`.

---

## 4. Transaction primitive (`01 §4`, D8)

All state-changing work runs inside **one** transaction per call (D8). The kernel defines the
`Tx` surface; the real runner lives in `@fleet/db` (which opens `BEGIN`, runs `fn`, flushes the
staged audit + outbox, then `COMMIT`; rollback on throw). The kernel ships a contract stub that
throws `TransactionError` if no runner is bound — a missing binding fails fast at startup.

```ts
interface DbClient {                       // structural — keeps shared pg-free
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface Tx {
  client: DbClient;                        // raw access for repositories (parameterised SQL only)
  registerOutbox(ev: OutboxEventInput): void;   // staged, flushed pre-COMMIT
  audit(input: AuditInput): void;               // staged, flushed pre-COMMIT
}

interface PoolLike { connect(): Promise<DbClient>; }

async function transaction<T>(pool: PoolLike, fn: (tx: Tx) => Promise<T>): Promise<T>;
```

**Staging contract:** `tx.audit(...)` and `tx.registerOutbox(...)` do **not** execute immediately.
They are buffered on the `Tx` and written in the same transaction just before `COMMIT`. This is
what guarantees side effects (audit trail, outbox events) are never lost if the process crashes
between commit and dispatch — the outbox is drained by the worker afterwards (§6).

`AuditInput.action` is a closed enum (`CREATE | UPDATE | DELETE | LOGIN | LOGIN_FAILED | LOGOUT |
OVERRIDE | VERIFY | FLAG | UNLOCK_FOR_CORRECTION | QUARANTINE | LIFT_QUARANTINE | EXPORT |
CONFIG_CHANGE | DEVICE_REVOKE | RECOVERY_MODE_ENABLE | RECOVERY_MODE_DISABLE`) — the audit
interceptor in `@fleet/api` stamps `actor_user_id` + `actor_role_codes` + `endpoint` + `http_*`
from the `Principal` and request (02 §1, 00 §4 invariant 2).

`OutboxEventInput` carries `event_type`, `aggregate_type`, `aggregate_id?`, `payload`, optional
`priority` (`LOW|NORMAL|HIGH|CRITICAL`) and `available_at`. Priority selects the worker drain
queue (§6, `05` §2).

---

## 5. Idempotency (`01 §5`, C5.1 / D4)

Every state-changing endpoint requires `Idempotency-Key: <uuid>` (C5.1). The API binds the
contract below to `app.idempotency_keys`, upserting **inside the same transaction** (D8) so a
replay is atomic with the original write.

```ts
interface IdempotencyStartInput { userId: string; key: string; endpoint: string; requestHash: string; }
interface IdempotencyCompleteInput {
  userId: string; key: string; state: "COMPLETED" | "FAILED";
  httpStatus: number; body: unknown; resourceId?: string;
}
interface IdempotencyStartResult { status: "NEW" | "REPLAY"; response?: CachedResponse; }
interface IdempotencyService {
  start(input: IdempotencyStartInput): Promise<IdempotencyStartResult>;
  complete(input: IdempotencyCompleteInput, tx: Tx): Promise<void>;
}
```

**State machine (handler flow, `03` §1):**

```
handler → IdempotencyService.start(K)
  ├─ NEW          → run service in transaction(); on success call complete(K, COMPLETED, 201, body, id, tx); COMMIT → 2xx
  ├─ REPLAY       → return cached CachedResponse verbatim (no service call, no side effect)
  └─ (key exists, IN_PROGRESS) → 409 IDEMPOTENCY_INFLIGHT  (client retries after backoff, 03 §8)

on completion, body differs from stored requestHash → 422 IDEMPOTENCY_CONFLICT
```

`requestHash` is a stable hash of the normalised body; a reused key whose hash differs is a
client bug (offline queue corruption) and is rejected rather than silently overwriting (A1.5).
The offline-queue protocol that makes this safe is in `03` §8.

---

## 6. Outbox relay (`01 §6`, D8)

Side effects (push/SMS/escalation/email, `05`) are **never** called inline in a request
transaction. They drain from `app.outbox_events` after commit via the relay. Handlers must be
idempotent because delivery is **at-least-once** (a crash between publish and ack re-delivers).

```ts
interface OutboxEvent {
  id: bigint; event_type: string; aggregate_type: string; aggregate_id?: string;
  payload: Record<string, unknown>;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  occurred_at: Date; available_at: Date; published_at: Date | null;
  attempts: number; last_error: string | null; dead_lettered_at: Date | null;
}
type OutboxHandler = (ev: OutboxEvent) => Promise<void>;

interface OutboxRelay {
  start(): void;
  registerHandler(eventType: string, handler: OutboxHandler): void;
  stop(): Promise<void>;
}
```

- `registerHandler` maps `event_type` → handler; unknown types are dead-lettered after retry
  exhaustion (`attempts` cap, then `dead_lettered_at`).
- `available_at` supports deferred dispatch (e.g. the C6.3 escalation timer, `accident-freeze`
  window clone).
- `CRITICAL` events (mayday escalation, N3.2) jump the priority queue.
- The relay runs inside the **worker** process (`05` §2); the API only inserts rows.

---

## 7. Config client (C2.4)

All tunable thresholds live in `system_config` and are editable at runtime (C2.4) — **no magic
numbers in code**. The key sets are **closed unions** generated from `db/seed/01_seed.sql` so a
new threshold is a compile error at every use site.

```ts
type NumericConfigKey   = "shift.max_duty_hours" | "fuel.anomaly_gauge_deviation_pct" | /* …57 keys */;
type StringConfigKey    = "accident.emergency_police_number" | "accident.emergency_ambulance_number" | "accident.fleet_manager_direct_number";
type BooleanConfigKey   = "maintenance.auto_quarantine_enabled";

interface ConfigClient {
  numeric(key: NumericConfigKey, defaultOverride?: number): Promise<number>;
  string(key: StringConfigKey, defaultOverride?: string | null): Promise<string | null>;
  boolean(key: BooleanConfigKey, defaultOverride?: boolean): Promise<boolean>;
}

const CONFIG_DEFAULTS: Record<string, number | string | boolean> = {
  "shift.max_duty_hours": 14,
  "fuel.anomaly_gauge_deviation_pct": 20,
  "auth.max_concurrent_sessions": 10,
  "retention.location_raw_days": 90,
  /* … mirrors the seed … */
};
```

The **live** client (in `@fleet/api`) reads `app.system_config`, caches in Redis (short TTL,
`00` §6), falls back to `CONFIG_DEFAULTS` when the row is absent, and writes through on admin
change (invalidates cache + writes `audit_logs` via the §4 interceptor). `CONFIG_DEFAULTS`
guarantees a fresh DB is usable before any seed is applied.

---

## 8. Time helpers (A2.3)

UTC is stored; **EAT (UTC+3)** is used only at the edge for display and for the operational-date
boundary. `operational_date` is a generated column in PG, so services use these helpers for API
windows/reporting only.

```ts
const OPERATIONAL_TZ = "Africa/Nairobi";
nowUtc(): Date;
toEAT(d: Date): Date;
operationalDate(d?: Date): string;            // YYYY-MM-DD in EAT (matches generated column)
type IntervalSpec = { minutes?: number; hours?: number; days?: number };
addInterval(d: Date, spec: IntervalSpec): Date;
withinWindow(a: Date, b: Date, spec: IntervalSpec): boolean;
intervalMs(spec: IntervalSpec): number;
```

`addInterval` is pure (used for the geofence autoclockout countdown, A1.7, and escalation
windows, C6.3). All db writes use `timestamptz`; services never persist a local-time string
(`00` §4 invariant 7).

---

## 9. Logging — structured JSON + redaction (`01 §9`)

A JSON logger ships in the kernel so every process emits the same shape. The **redactor is
mandatory**: keys matching `/(pin|password|secret|token|apikey|api_key|key)$/i` are replaced
with `[redacted]`, recursively, with circular-reference guarding.

```ts
type LogLevel = "debug" | "info" | "warn" | "error";
interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>, err?: unknown): void;
  child(defaultMeta: Record<string, unknown>): Logger;
}
```

`ConsoleLogger` writes one JSON line per entry (level, msg, time ISO, defaultMeta, meta, error).
`logger` is the shared default instance. **Invariant:** no secret or PII reaches a log sink —
`system_config.is_sensitive`, PII, and tokens are redacted by construction (`00` §4 invariant 6).
CloudWatch/Sentry shipping is layered in `@fleet/api`/`worker` (`09`).

---

## 10. Schemas (zod) — validation

Request bodies/queries are validated by **zod** schemas that mirror `api/openapi.yaml` (the spec
is authoritative; divergence is a CI failure, `00` §5). The API imports these directly in routers
(`03` §1 step 1).

```ts
// schemas/shifts.ts
const ClockInSchema = z.object({
  assignment_id: z.string().uuid(),
  start_odometer_km: z.number().int().nonnegative(),
  start_fuel_gauge: FuelGaugeLevel,             // EMPTY|QUARTER|HALF|THREE_QUARTER|FULL (B2)
  start_media_object_id: z.string().uuid(),     // B1
  phone_gps_fallback_enabled: z.boolean().default(false),
  consent_version: z.string().min(1),
});

// schemas/fuel.ts — before+after gauge pair enforced (B3)
const RefuelSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid(),
  fuel_card_last_four: z.string().regex(/^\d{4}$/),
  litres: z.number().positive(),
  total_cost: z.object({ amount: z.string(), currency: z.string().length(3).default("KES") }),
  before_fuel_record_id: z.string().uuid(),
  after_fuel_record_id: z.string().uuid(),
  receipt_media_object_id: z.string().uuid(),
  /* … */
});

// schemas/accidents.ts — mayday requires only position + reason (B17)
const MaydaySchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid().nullable(),
  position: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  mayday_reason: z.string().min(1).max(500),
});

// Cursor pagination envelope — every list endpoint (D7)
const CursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable(), has_more: z.boolean() });
```

`z.infer<typeof X>` produces the exact input type the services receive — the single source of
truth shared with mobile/admin (00 §5). The contract-test task asserts each schema stays
consistent with `openapi.yaml`.

---

## 11. Validation rule → `error_code` mapping (`01 §11`)

The service layer returns these codes so the DB constraint (the final authority, `03` §5) is
surfaced as a clean client-switchable string:

| Rule | Enforced by (service re-check) | `error_code` | HTTP |
|---|---|---|---|
| Odometer cannot decrease within shift | `fn_shifts_validate_start_odometer` | `ODOMETER_DECREASED` | 422 |
| No duplicate start/end gauge record | unique indexes | `DUPLICATE` | 409 |
| Refuel requires before+after gauge | `fuel_purchases_driver_entry_has_gauge_pair` | `MISSING_GAUGE_PAIR` | 422 |
| DVIR fail requires photo | deferred constraint | `DVIR_FAIL_NEEDS_PHOTO` | 422 |
| DVIR defects acknowledged | `inspections_defects_must_be_reviewed` | `DEFECTS_NOT_REVIEWED` | 422 |
| No open shift if pending close-out | `fn_shifts_block_when_pending_closeout` | `CLOCKOUT_PENDING` | 409 |
| HOS rest not complete | `driver_hos_state.next_eligible_clock_in_at` | `HOS_REST_BLOCKED` | 422 |
| GPS consent missing | `user_consents` check | `CONSENT_REQUIRED` | 403 |
| Verified shift edited without unlock | unlock check | `UNLOCK_REQUIRED` | 409 |
| Idempotency key reused, body differs | `idempotency_keys` | `IDEMPOTENCY_CONFLICT` | 422 |
| Assignment mandatory before clock-in | `assignments` existence | `NO_ASSIGNMENT` | 409 |
| Mandatory field/shape bad | zod | `VALIDATION_ERROR` | 400 |

---

## 12. Invariants this document locks

1. `@fleet/shared` is pg-free and has no dependency on `api`/`worker`; it is consumed as built `dist/`.
2. Expected failures are `Result<Err>`; `error_code` is the only client-branchable member.
3. One transaction per write; audit + outbox are staged on `Tx` and flushed pre-COMMIT (D8).
4. Idempotency is enforced API-side against `app.idempotency_keys` inside the transaction (C5.1/D4).
5. Side effects drain only from the outbox, at-least-once, via idempotent handlers (D8).
6. All thresholds come from `ConfigClient`; the key unions are generated, defaults mirrored in `CONFIG_DEFAULTS`.
7. Logs redact secrets/PII by construction; time is UTC in the DB, EAT at the edge (A2.3).

`02-auth.md` (already delivered) builds on `Principal` + `IdempotencyService`. `03-rest-api.md`
(already delivered) builds on `transaction()` + schemas. `04`–`09` follow.
