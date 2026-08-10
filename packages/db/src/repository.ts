// packages/db/src/repository.ts
// Base repository. Owns SQL, no business logic. Parameterised queries only — table and
// column names come from code (the allow-list is the set of repository definitions, 00 §4
// invariant 1), never from request input. Soft-delete sets deleted_at; hard delete is
// trigger-rejected downstream (D3).
//
// Multi-tenancy (14_tenancy.sql): a repository constructed with a `tenantId` appends an explicit
// `AND tenant_id = $n` to every read and stamps `tenant_id` onto every insert. Postgres RLS
// already enforces this, so the filter here is deliberate DEFENCE IN DEPTH: it keeps isolation
// intact even if a connection is somehow borrowed without `SET LOCAL app.current_tenant_id`
// applied, and it makes the intent visible in the query plan and the logs.
//
// Repositories over global tables (app.users, app.roles, app.user_sessions, ...) are simply
// constructed without a tenantId and behave exactly as before.

import type { DbClient } from "@fleet/shared";

export interface RepositoryOptions {
  idColumn?: string;
  // Set to null on tables that are not soft-deletable (e.g. append-only). Defaults to "deleted_at".
  deletedAtColumn?: string | null;
  /**
   * Owning tenant. When set, every generated statement is tenant-filtered and every insert is
   * tenant-stamped. Omit for global/platform tables.
   */
  tenantId?: string | null;
  /** Column holding the tenant. Defaults to "tenant_id". */
  tenantColumn?: string;
}

export abstract class BaseRepository<TRow extends object = Record<string, unknown>> {
  protected readonly idColumn: string;
  protected readonly deletedAtColumn: string | null;
  protected readonly tenantId: string | null;
  protected readonly tenantColumn: string;

  constructor(
    protected readonly client: DbClient,
    protected readonly table: string,
    opts: RepositoryOptions = {},
  ) {
    this.idColumn = opts.idColumn ?? "id";
    this.deletedAtColumn = opts.deletedAtColumn === undefined ? "deleted_at" : opts.deletedAtColumn;
    this.tenantId = opts.tenantId ?? null;
    this.tenantColumn = opts.tenantColumn ?? "tenant_id";
  }

  /** Public read-accessor for the underlying client (used by query services over views). */
  get dbClient(): DbClient {
    return this.client;
  }

  /** True when this repository is bound to a tenant. */
  protected get isTenantScoped(): boolean {
    return this.tenantId !== null;
  }

  /**
   * `AND tenant_id = $n` for the next free placeholder, or an empty string when the table is
   * global. Returns the clause plus the parameter to append.
   */
  protected tenantClause(nextParamIndex: number): { sql: string; params: unknown[] } {
    if (this.tenantId === null) return { sql: "", params: [] };
    return { sql: ` AND ${this.tenantColumn} = $${nextParamIndex}`, params: [this.tenantId] };
  }

  async getById(id: string): Promise<TRow | null> {
    const where = this.deletedAtColumn ? `AND ${this.deletedAtColumn} IS NULL` : "";
    const tenant = this.tenantClause(2);
    const res = await this.client.query<TRow>(
      `SELECT * FROM ${this.table} WHERE ${this.idColumn} = $1 ${where}${tenant.sql} LIMIT 1`,
      [id, ...tenant.params],
    );
    return (res.rows[0] ?? null) as TRow | null;
  }

  async insert(row: Record<string, unknown>): Promise<TRow> {
    // Stamp the tenant unless the caller supplied one explicitly (which the RLS WITH CHECK will
    // then validate against the session tenant anyway).
    const payload =
      this.tenantId !== null && row[this.tenantColumn] === undefined
        ? { ...row, [this.tenantColumn]: this.tenantId }
        : row;
    const cols = Object.keys(payload);
    const params = cols.map((_, i) => `$${i + 1}`);
    const res = await this.client.query<TRow>(
      `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${params.join(", ")}) RETURNING *`,
      cols.map((c) => payload[c]),
    );
    return res.rows[0] as TRow;
  }

  async update(id: string, patch: Partial<TRow>): Promise<TRow> {
    const record = patch as Record<string, unknown>;
    // The tenant of a row is immutable: moving a row between tenants is not an update, it is a
    // data-migration decision that must never be reachable from a generic patch.
    const cols = Object.keys(record).filter((c) => c !== this.idColumn && c !== this.tenantColumn);
    if (cols.length === 0) return (await this.getById(id)) as TRow;
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    const tenant = this.tenantClause(cols.length + 2);
    const res = await this.client.query<TRow>(
      `UPDATE ${this.table} SET ${sets.join(", ")} WHERE ${this.idColumn} = $${cols.length + 1}${tenant.sql} RETURNING *`,
      [...cols.map((c) => record[c]), id, ...tenant.params],
    );
    return res.rows[0] as TRow;
  }

  async softDelete(id: string): Promise<void> {
    if (!this.deletedAtColumn) throw new Error(`table ${this.table} is not soft-deletable`);
    const tenant = this.tenantClause(2);
    await this.client.query(
      `UPDATE ${this.table} SET ${this.deletedAtColumn} = now() WHERE ${this.idColumn} = $1${tenant.sql}`,
      [id, ...tenant.params],
    );
  }
}
