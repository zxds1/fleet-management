// packages/api/src/repositories/privacy.ts
// Data Subject Access Request (DSAR) ledger repository (15_privacy_requests.sql).
// Parameterised SQL only (06 §2); no business rules. `app.privacy_requests` is
// append-only (UPDATE/DELETE are trigger-rejected), so only inserts and reads exist here.
// Every read is tenant-filtered (defence in depth on top of RLS).

import { BaseRepository } from "@fleet/db";
import type { DbClient, PrivacyRequestRow } from "@fleet/shared";
import type { Cursor } from "../http/pagination";

export class PrivacyRequestRepository extends BaseRepository<PrivacyRequestRow> {
  constructor(client: DbClient) {
    super(client, "app.privacy_requests", { deletedAtColumn: null });
  }

  async create(input: {
    tenantId: string;
    userId: string;
    requestType: string;
    notes?: string | null;
  }): Promise<PrivacyRequestRow> {
    const res = await this.client.query<PrivacyRequestRow>(
      `INSERT INTO app.privacy_requests (tenant_id, user_id, request_type, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.tenantId, input.userId, input.requestType, input.notes ?? null],
    );
    return res.rows[0] as PrivacyRequestRow;
  }

  /** The driver's own request history, newest first (cursor page). */
  async listForUser(
    userId: string,
    opts: { limit: number; cursor?: Cursor | null },
  ): Promise<PrivacyRequestRow[]> {
    const params: unknown[] = [userId];
    let keyset = "";
    if (opts.cursor) {
      const n = params.length + 1;
      params.push(opts.cursor.sort, opts.cursor.id);
      keyset = `AND (pr.created_at, pr.id) < ($${n}::timestamptz, $${n + 1}::uuid)`;
    }
    const limitIdx = params.length + 1;
    params.push(opts.limit);

    const res = await this.client.query<PrivacyRequestRow>(
      `SELECT * FROM app.privacy_requests pr
        WHERE pr.user_id = $${1}::uuid
          AND pr.tenant_id = app.fn_current_tenant_id()
          ${keyset}
        ORDER BY pr.created_at DESC, pr.id DESC
       LIMIT $${limitIdx}`,
      params,
    );
    return res.rows;
  }

  /** Single request scoped to the caller's user_id (tenant-isolated via RLS + explicit filter). */
  async findByIdForUser(id: string, userId: string): Promise<PrivacyRequestRow | null> {
    const res = await this.client.query<PrivacyRequestRow>(
      `SELECT * FROM app.privacy_requests
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND tenant_id = app.fn_current_tenant_id()
        LIMIT 1`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  /** Admin/manager view: all requests for the tenant. */
  async listForTenant(
    opts: { limit: number; cursor?: Cursor | null; statuses?: string[] },
  ): Promise<PrivacyRequestRow[]> {
    const params: unknown[] = [];
    let statusClause = "";
    if (opts.statuses && opts.statuses.length > 0) {
      const placeholders = opts.statuses.map((_, i) => `$${params.length + 1 + i}`).join(",");
      params.push(...opts.statuses);
      statusClause = `AND pr.status IN (${placeholders})`;
    }
    let keyset = "";
    if (opts.cursor) {
      const sortIdx = params.length + 1;
      const idIdx = sortIdx + 1;
      params.push(opts.cursor.sort, opts.cursor.id);
      keyset = `AND (pr.created_at, pr.id) < ($${sortIdx}::timestamptz, $${idIdx}::uuid)`;
    }
    const limitIdx = params.length + 1;
    params.push(opts.limit);

    const res = await this.client.query<PrivacyRequestRow>(
      `SELECT * FROM app.privacy_requests pr
        WHERE pr.tenant_id = app.fn_current_tenant_id()
          ${statusClause}
          ${keyset}
        ORDER BY pr.created_at DESC, pr.id DESC
       LIMIT $${limitIdx}`,
      params,
    );
    return res.rows;
  }

  async markDownloaded(id: string): Promise<void> {
    await this.client.query(
      `UPDATE app.privacy_requests
          SET status = 'DOWNLOADED', completed_at = now()
        WHERE id = $1::uuid
          AND status = 'READY'
          AND download_token IS NOT NULL`,
      [id],
    );
  }
}
