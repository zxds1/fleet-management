// packages/db/src/repository.ts
// Base repository. Owns SQL, no business logic. Parameterised queries only — table and
// column names come from code (the allow-list is the set of repository definitions, 00 §4
// invariant 1), never from request input. Soft-delete sets deleted_at; hard delete is
// trigger-rejected downstream (D3).

import type { DbClient } from "@fleet/shared";

export interface RepositoryOptions {
  idColumn?: string;
  // Set to null on tables that are not soft-deletable (e.g. append-only). Defaults to "deleted_at".
  deletedAtColumn?: string | null;
}

export abstract class BaseRepository<TRow extends object = Record<string, unknown>> {
  protected readonly idColumn: string;
  protected readonly deletedAtColumn: string | null;

  constructor(
    protected readonly client: DbClient,
    protected readonly table: string,
    opts: RepositoryOptions = {},
  ) {
    this.idColumn = opts.idColumn ?? "id";
    this.deletedAtColumn = opts.deletedAtColumn === undefined ? "deleted_at" : opts.deletedAtColumn;
  }

  /** Public read-accessor for the underlying client (used by query services over views). */
  get dbClient(): DbClient {
    return this.client;
  }

  async getById(id: string): Promise<TRow | null> {
    const where = this.deletedAtColumn ? `AND ${this.deletedAtColumn} IS NULL` : "";
    const res = await this.client.query<TRow>(
      `SELECT * FROM ${this.table} WHERE ${this.idColumn} = $1 ${where} LIMIT 1`,
      [id],
    );
    return (res.rows[0] ?? null) as TRow | null;
  }

  async insert(row: Record<string, unknown>): Promise<TRow> {
    const cols = Object.keys(row);
    const params = cols.map((_, i) => `$${i + 1}`);
    const res = await this.client.query<TRow>(
      `INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${params.join(", ")}) RETURNING *`,
      cols.map((c) => row[c]),
    );
    return res.rows[0] as TRow;
  }

  async update(id: string, patch: Partial<TRow>): Promise<TRow> {
    const record = patch as Record<string, unknown>;
    const cols = Object.keys(record).filter((c) => c !== this.idColumn);
    if (cols.length === 0) return (await this.getById(id)) as TRow;
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    const res = await this.client.query<TRow>(
      `UPDATE ${this.table} SET ${sets.join(", ")} WHERE ${this.idColumn} = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => record[c]), id],
    );
    return res.rows[0] as TRow;
  }

  async softDelete(id: string): Promise<void> {
    if (!this.deletedAtColumn) throw new Error(`table ${this.table} is not soft-deletable`);
    await this.client.query(
      `UPDATE ${this.table} SET ${this.deletedAtColumn} = now() WHERE ${this.idColumn} = $1`,
      [id],
    );
  }
}
