// packages/db/src/errorEvents.ts
// Error <-> flow correlation store (audit #6). Mirrors every >=400 RFC7807 response that carries an
// error_code into app.error_events so a single issue can be correlated by request_id / route / tenant
// / flow_step and aggregated by fingerprint (audit #7). Append-only: no update/delete.

import type { DbClient } from "@fleet/shared";

export type ErrorSeverity = "debug" | "info" | "warn" | "error" | "critical";

export interface ErrorEventInput {
  request_id?: string | null;
  error_code: string;
  flow_step?: string | null;
  route?: string | null;
  tenant_id?: string | null;
  geography?: string | null;
  severity?: ErrorSeverity;
  message?: string | null;
  fingerprint: string;
}

export interface ErrorEventRow extends ErrorEventInput {
  id: number;
  created_at: Date;
}

const INSERT = `
  INSERT INTO app.error_events (
    request_id, error_code, flow_step, route, tenant_id, geography, severity, message, fingerprint
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING id, request_id, error_code, flow_step, route, tenant_id, geography, severity, message, fingerprint, created_at`;

export class ErrorEventsRepository {
  constructor(private readonly client: DbClient) {}

  /**
   * Persists one error event. Failures are the caller's responsibility to swallow (the problem
   * handler persists fire-and-forget); this method never throws a domain-significant error but
   * rethrows so the fire-and-forget wrapper can log it.
   */
  async insert(input: ErrorEventInput): Promise<ErrorEventRow> {
    const res = await this.client.query<ErrorEventRow>(INSERT, [
      input.request_id ?? null,
      input.error_code,
      input.flow_step ?? null,
      input.route ?? null,
      input.tenant_id ?? null,
      input.geography ?? null,
      input.severity ?? "error",
      input.message ?? null,
      input.fingerprint,
    ]);
    return res.rows[0]!;
  }
}
