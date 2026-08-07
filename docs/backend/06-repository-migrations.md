# Backend Design 06 — Repository Pattern, Migrations & Data Integrity

**Status:** Design (no code). **Depends on:** `00-overview.md`, `01-shared-kernel.md` (Tx §4,
AppError §2, Result §3), `docs/architecture/00-locked-decisions.md` (D1–D8, C5.9, C6.5, N2.2),
`db/schema/*`, `db/seed/*`.

This document specifies how data is accessed and how the schema lives. It covers the repository
pattern, parameterised-SQL-only rule, soft-delete/append-only enforcement, partitioning access,
and the migration runner. It is the implementation contract for `@fleet/db` and the repositories
used by every service.

---

## 1. Layering (recap, `00` §4)

```
handler → service (rules) → repository (parameterised SQL) → PostgreSQL (+ PostGIS)
                                       ↑ owns SQL, NO business logic
```

Repositories receive a `Tx` (or `DbClient`) from `transaction()` (`01` §4) and issue **only**
parameterised queries. They return domain rows typed by the generated `db.ts` (`01` §1) or
`Result`/errors from `01` §2/§3.

---

## 2. Repository contract

```ts
// Conceptual shape — implemented in @fleet/db, typed via shared
interface Repository<TRow> {
  getById(tx: Tx, id: string): Promise<TRow | null>;
  insert(tx: Tx, row: TRow): Promise<TRow>;
  update(tx: Tx, id: string, patch: Partial<TRow>): Promise<TRow>;
  // soft-delete only — never physical delete (D3)
  softDelete(tx: Tx, id: string): Promise<void>;
}
```

Rules:
- **No SQL string concatenation with user input.** All values are `$1, $2, …` params. Dynamic
  identifiers (sort column, filter key) come from an **allow-list** enumerated in code, never
  interpolated from the request (`00` §4 invariant 1). Cursor pagination sort tuples are validated
  against the allow-list before building the `ORDER BY`.
- **One transaction per write (D8):** the service opens `transaction()`; repositories call
  `tx.client.query(...)` and stage `tx.audit(...)` / `tx.registerOutbox(...)`. Commit is the
  runner's job (`01` §4).
- **Return `Result` for expected failures**, throw only on transport errors (mapped to
  `SERVICE_UNAVAILABLE` at the handler).

---

## 3. Soft delete (D3)

Master records carry `deleted_at timestamptz null`. The repository `softDelete` sets it; a
`fn_reject_hard_delete` trigger rejects `DELETE` on protected tables with `restrict_violation`.
Queries from repositories **always** append `AND deleted_at IS NULL` (or expose a `includeDeleted`
flag for auditors/`AUDITOR` role). Hard-delete is impossible by construction.

---

## 4. Append-only tables (C6.5 / C3.4)

`audit_logs`, `accident_telemetry`, `accident_media` reject `UPDATE`/`DELETE` via trigger
(`fn_reject_update_delete` variants). Writes go through dedicated repository methods; any update
attempt raises `restrict_violation` at the DB. Repositories never attempt an update on these.

---

## 5. Partitioning access (C5.9 / D6)

- `telemetry.location_updates` is **native declarative partitioned** monthly on the time column.
  The `partition-maint` worker (`05` §2 #10) pre-creates the next 3 months; `retention`
  (`05` §2 #11) summarises then drops expired partitions whole — never row-by-row `DELETE`.
- Repositories do **not** name a partition; they target the parent table and let the planner route
  by the partition key. Queries always carry a time bound so they prune to the relevant partitions
  (this is also what makes the 90-day raw retention cheap).
- `audit_logs` is partitioned identically; the 7-year retention (C6.5) is satisfied by **not**
  dropping audit partitions (legal hold by design).

---

## 6. Cross-database isolation (N2.2)

Traccar owns its **own logical database** (`traccar`) on the same RDS instance, with its own role
and **no cross-database grants**. Our `DbClient` connects only to the `fleet` database. Provisioning
writes to Traccar via Traccar's REST API (one-way, N2.1); we never query Traccar's tables from our
services.

---

## 7. Migration runner

- **No ORM by default** (`00` §2). DDL lives as ordered, reviewed SQL in `db/schema/*.sql`
  (authoritative for table shape) + `db/seed/*.sql` (config defaults, permission seed, checklist
  templates, emergency numbers).
- The runner applies migrations in a single transactional batch per version, records
  `applied_migrations`, and is **idempotent** (re-run is a no-op). Down-migrations are manual and
  reviewed (schema is modelled for all three phases now, N10; additive migrations only).
- **Row types are generated**, not hand-maintained (`00` §5): `pg-to-ts` against the applied
  schema on `:5444` produces `shared/src/types/db.ts`. CI (`09`) fails if a committed `db.ts`
  diverges from the live schema, keeping TypeScript honest about columns/enums/generated columns.
- Seed values that the code references as closed unions — `PermissionCode` (N4), the
  `NumericConfigKey` set (`01` §7), emergency numbers — are generated-from / mirrored so a missing
  grant or threshold is a compile error.

---

## 8. Connection & pool contract

`PoolLike.connect(): Promise<DbClient>` (`01` §4) is the only surface repositories need. The real
`@fleet/db` pool:
- uses a checked-out client for the duration of `transaction()` and returns it on commit/rollback;
- sets `statement_timeout` and a connection limit sized to the process;
- enables `prepare` for hot queries where safe.

Repositories are agnostic to pooling — they take whatever `Tx`/`DbClient` they are handed.

---

## 9. Invariants this document locks

1. Repositories issue parameterised SQL only; dynamic identifiers use an allow-list.
2. No business logic in repositories; rules live in services.
3. Soft delete everywhere on master rows; hard delete is trigger-rejected (D3).
4. Append-only tables reject mutation by trigger (C6.5/C3.4).
5. Partition access is via the parent table with a time bound; retention drops whole partitions.
6. DDL is the authority; row types are generated and CI-checked; migrations are idempotent.

`07-websocket-gateway.md` covers the real-time read path that consumes this data without owning it.
