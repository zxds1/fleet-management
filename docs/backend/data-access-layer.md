# Backend Design — Data Access Layer (`@fleet/db`)

**Status:** Implemented (v1.0). **Depends on:** `00-overview.md`, `01-shared-kernel.md`,
`06-repository-migrations.md`, `docs/architecture/00-locked-decisions.md` (D1–D8, C5.9, C6.5, N2.2),
`packages/shared`.

This document specifies the **data access layer** package (`packages/db`, published as
`@fleet/db`). It is the only package that touches the `pg` driver and is the concrete
implementation of the contracts declared in `01-shared-kernel.md` (`transaction`, `Tx`,
`IdempotencyService`, `OutboxRelay`, `ConfigClient`) and the repository/migration rules in
`06-repository-migrations.md`. The code in `packages/db/src/**` is the source of truth; this
document describes its public API, usage, and invariants.

Cross-reference: the shared kernel ships a **stub** `transaction()` that throws
`TransactionError` if no runner is bound — `@fleet/db` replaces it with the real runner at
runtime. Apps import the real primitives from `@fleet/db`, and the shared types (`Tx`,
`PoolLike`, `DbClient`, `AppError`, …) from `@fleet/shared`.

---

## 1. Package boundary

```
@fleet/api / @fleet/worker / @fleet/ws
        │  import { transaction, createPool, BaseRepository,
        │          PgIdempotencyService, PgOutboxRelay, PgConfigClient } from "@fleet/db"
        ▼
   packages/db  ── pg ──▶ PostgreSQL (+ PostGIS)
        ▲
        │  imports types only
   @fleet/shared  (Tx, PoolLike, DbClient, ConfigClient, AppError, CONFIG_DEFAULTS)
```

Rules (from `00` §2 / `06` §1):
- `@fleet/db` is the **only** place that imports `pg`. It satisfies the shared `DbClient` /
  `PoolLike` contracts structurally, so `shared` stays pg-free.
- Repositories own SQL; services own rules; handlers own HTTP mapping (`00` §4).
- No ORM by default — queries are hand-written and parameterised (`06` §2).

---

## 2. Pool — `createPool` (`src/pool.ts`)

```ts
import { createPool } from "@fleet/db";
const pool = createPool({ host, port, user, password, database, max: 10, statementTimeoutMs: 30_000 });
// pool satisfies PoolLike; pool.end() closes the underlying pg.Pool.
```

`createPool` builds a `pg.Pool` and returns a `PoolLike` whose `connect()` checks out a pooled
client (which structurally satisfies `DbClient`: `query` + `release`). The client is returned to
the pool by the transaction runner's `finally` block.

---

## 3. Transaction runner — `transaction` (`src/transaction.ts`, D8)

Every state-changing call opens exactly one transaction. The runner:

1. `BEGIN`.
2. Builds a `PgTx` and runs `fn(tx)` — repositories issue SQL via `tx.client`; services stage
   audit + outbox entries.
3. **Flushes staged entries just before COMMIT** (the D8 guarantee): for each `tx.audit(...)` it
   inserts into `app.audit_logs`; for each `tx.registerOutbox(...)` it inserts into
   `app.outbox_events`. So audit trail + side-effect queuing can never be lost between commit and
   outbox drain.
4. `COMMIT` on success; `ROLLBACK` + wrap in `TransactionError` on throw; `release()` always.

```ts
import { transaction } from "@fleet/db";

const shift = await transaction(pool, async (tx) => {
  const s = await shiftRepo.insert(tx.client, { /* … */ });
  tx.audit({ action: "CREATE", entity_table: "shifts", entity_id: s.id, endpoint: "/shifts/clock-in" });
  tx.registerOutbox({ event_type: "shift.started", aggregate_type: "shift", aggregate_id: s.id, payload: { id: s.id } });
  return s;
});
```

`Tx` (`src/tx.ts`) is a thin buffer: `client`, `registerOutbox`, `audit`. The flush SQL lives in
the runner, keeping `Tx` free of inserts.

---

## 4. Repository — `BaseRepository` (`src/repository.ts`)

A generic, parameterised base. Table/column names come from code (the allow-list of repository
definitions, `00` §4 invariant 1) — **never** from request input. Values are always `$1, $2, …`
params.

```ts
class ShiftRepository extends BaseRepository<ShiftRow> {
  constructor(client: DbClient) { super(client, "app.shifts", { idColumn: "id" }); }
}
const repo = new ShiftRepository(tx.client);
const s = await repo.getById(id);          // SELECT … WHERE id=$1 AND deleted_at IS NULL
const created = await repo.insert({ /* … */ });
const updated = await repo.update(id, { end_odometer_km: 123 });
await repo.softDelete(id);                  // SET deleted_at=now()
```

- `getById` automatically appends `AND deleted_at IS NULL` (soft delete, D3).
- `softDelete` sets `deleted_at`; tables with `deletedAtColumn: null` throw (append-only tables, C6.5).
- The DB still rejects hard deletes via `fn_reject_hard_delete` (defence in depth).

---

## 5. Migrations — `runMigrations` (`src/migrations.ts`, `06` §7)

Idempotent, ordered, hash-checked.

```ts
import { runMigrations } from "@fleet/db";
const { applied, skipped } = await runMigrations(pool, path.resolve("db/schema"));
```

- Ensures `app.applied_migrations` exists, then applies every `*.sql` in `db/schema` in sort
  order, each in its own `BEGIN/COMMIT`.
- Records `name` + a content hash; re-running skips already-applied files (and detects a changed
  file via hash mismatch at a later stage).
- `ensureMigrationsTable` is called internally; DDL is the authority for table shape (`00` §5) and
  row types are generated into `shared/src/types/db.ts` by a separate `pg-to-ts` step.

---

## 6. Idempotency — `PgIdempotencyService` (`src/idempotency.ts`, C5.1 / D4)

```ts
const idem = new PgIdempotencyService(pool);
const r = await idem.start({ userId, key, endpoint, requestHash }); // NEW | REPLAY
if (r.status === "REPLAY") return r.response;                       // cached, no service call
const result = await transaction(pool, async (tx) => {
  /* …service work… */
  await idem.complete({ userId, key, state: "COMPLETED", httpStatus: 201, body: result, resourceId }, tx);
});
```

State machine (`01` §5): first `start` → `NEW` (inserts `IN_PROGRESS`); completed key → `REPLAY`
with cached `CachedResponse`; still `IN_PROGRESS` → throws `IdempotencyInFlight` (409); completed key
with a **different** `requestHash` → throws `IdempotencyConflict` (422). `complete` writes inside
the caller's transaction so the cached response commits atomically with the write.

---

## 7. Outbox relay — `PgOutboxRelay` (`src/outbox.ts`, D8)

Drains `app.outbox_events` after commit; handlers must be idempotent (at-least-once, `01` §6).

```ts
const relay = new PgOutboxRelay(pool, { intervalMs: 1000, batchSize: 50, maxAttempts: 5 });
relay.registerHandler("shift.started", async (ev) => { /* notify live map / HOS recompute */ });
relay.start();                 // polling loop; unref() so it never holds the process open
await relay.stop();
```

- Polls unpublished, due rows (`published_at IS NULL AND available_at <= now()`) in **priority
  order** (`CRITICAL > HIGH > NORMAL > LOW`).
- Success → `published_at = now()`. Failure → `attempts++`, `last_error` set, and after
  `maxAttempts` the row is `dead_lettered_at` (surfaced for ops).
- Runs in the **worker** process (`05` §2); the API only inserts rows.

---

## 8. Config — `PgConfigClient` (`src/config.ts`, C2.4)

```ts
const config = new PgConfigClient(pool, redisCache);   // redisCache optional
const maxDuty = await config.numeric("shift.max_duty_hours");        // 14, or CONFIG_DEFAULTS
const ackTimeout = await config.string("accident.fleet_manager_direct_number");
const autoQuar = await config.boolean("maintenance.auto_quarantine_enabled");
```

- Reads `app.system_config`; caches in the supplied `Cache` (Redis in prod) with a 30 s TTL.
- Falls back to `CONFIG_DEFAULTS` (mirrored from the seed) when the row is absent — a fresh DB is
  always usable (`01` §7).
- The closed `NumericConfigKey`/`StringConfigKey`/`BooleanConfigKey` unions make a missing threshold
  a compile error at every use site (no magic numbers).

---

## 9. Usage from a service

```ts
import {
  transaction, createPool, BaseRepository,
  PgIdempotencyService, PgOutboxRelay, PgConfigClient,
} from "@fleet/db";
import { ok, err, violation } from "@fleet/shared";

export class ShiftService {
  constructor(
    private pool: ReturnType<typeof createPool>,
    private idem: PgIdempotencyService,
    private config: PgConfigClient,
  ) {}

  async clockIn(input: ClockInInput, principal: Principal) {
    const start = await this.idem.start({ /* … */ });
    if (start.status === "REPLAY") return ok(start.response!.body);
    return transaction(this.pool, async (tx) => {
      const repo = new ShiftRepository(tx.client);
      if (input.start_odometer_km < current) return err(violation("ODOMETER_DECREASED", "…"));
      const shift = await repo.insert({ /* … */ });
      tx.audit({ action: "CREATE", entity_table: "shifts", entity_id: shift.id, actor_user_id: principal.userId });
      tx.registerOutbox({ event_type: "shift.started", aggregate_type: "shift", aggregate_id: shift.id, payload: { id: shift.id } });
      await this.idem.complete({ /* … COMPLETED … */ }, tx);
      return ok(shift);
    });
  }
}
```

---

## 10. Invariants this document locks

1. `@fleet/db` is the only pg-touching package; it satisfies the shared `DbClient`/`PoolLike`
   contracts structurally.
2. One transaction per write; audit + outbox are staged on `Tx` and flushed pre-COMMIT (D8).
3. Repositories issue parameterised SQL only; table/column names come from code, never the request.
4. Migrations are idempotent, ordered, and hash-checked; DDL is authoritative; row types are generated.
5. Idempotency is atomic with the write; replay returns the cached response; in-flight/conflict throw.
6. The outbox drains at-least-once in priority order; handlers are idempotent; it runs in the worker.
7. All thresholds flow through `PgConfigClient` with Redis cache + `CONFIG_DEFAULTS` fallback.

`06-repository-migrations.md` is the design counterpart; `01-shared-kernel.md` declares the
contracts this package implements.
