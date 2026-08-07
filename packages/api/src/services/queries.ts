// packages/api/src/services/queries.ts
// Read-only query services for the §2.7 insights surface: the unified open-anomaly feed, expiring
// asset documents, and the live vehicle display-state snapshot. All use keyset cursor pagination
// (D7) or a read snapshot; they never mutate and run on a pooled client. `error_code` is the only
// client-branchable member, so a malformed cursor maps to VALIDATION_ERROR (08 §1).

import { type DbClient, type Result, ok } from "@fleet/shared";
import type { AssetDocumentRow } from "@fleet/shared";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage } from "../http/pagination";

export interface AnomalyRow {
  domain: string;
  id: string;
  severity: string;
  kind: string;
  vehicle_id: string | null;
  driver_id: string | null;
  detected_at: string;
  detail: unknown;
}

export class AnomalyQuery {
  constructor(private readonly client: DbClient) {}

  /** Cursor page over `app.v_open_anomalies` (fuel/HOS/accident/maintenance/security). Keyset on (detected_at DESC, id DESC). */
  async feed(opts: { domains?: string[]; limit: number; cursor?: string }): Promise<Result<{ data: AnomalyRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const params: unknown[] = [];
    const where: string[] = [];

    if (opts.domains && opts.domains.length > 0) {
      params.push(opts.domains);
      where.push(`domain = ANY($${params.length}::text[])`);
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(detected_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const res = await this.client.query<AnomalyRow>(
      `SELECT domain, id, severity, kind, vehicle_id, driver_id, detected_at, detail
         FROM app.v_open_anomalies ${whereSql}
        ORDER BY detected_at DESC, id DESC
        LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const page = buildPage(res.rows, limit, (row) => ({ sort: String(row.detected_at ?? ""), id: row.id }));
    return ok(page);
  }
}

export class DocumentQuery {
  constructor(private readonly client: DbClient) {}

  /** Cursor page over `asset_documents` expiring within `withinDays` of today (3.5 / B8). Keyset on (expires_on ASC, id ASC). */
  async expiring(opts: { withinDays: number; limit: number; cursor?: string }): Promise<Result<{ data: AssetDocumentRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const withinDays = Math.max(0, opts.withinDays);
    const params: unknown[] = [withinDays];
    const where = [
      "deleted_at IS NULL",
      "superseded_by_id IS NULL",
      "expires_on >= current_date",
      `expires_on <= (current_date + ($1 || ' days')::interval)`,
    ];

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(expires_on, id) > ($${params.length - 1}::date, $${params.length})`);
    }

    const res = await this.client.query<AssetDocumentRow>(
      `SELECT * FROM app.asset_documents WHERE ${where.join(" AND ")}
        ORDER BY expires_on ASC, id ASC
        LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const page = buildPage(res.rows, limit, (row) => ({ sort: String(row.expires_on ?? ""), id: row.id }));
    return ok(page);
  }
}

export interface VehicleState {
  vehicle_id: string;
  display_state: string;
  latitude: number | null;
  longitude: number | null;
  driver_name: string | null;
  next_eligible_clock_in_at: string | null;
}

export class DashboardQuery {
  constructor(private readonly client: DbClient) {}

  /** Live map marker snapshot from `app.v_vehicle_display_state` (N5). Not paginated. */
  async vehicleStates(): Promise<Result<{ vehicles: VehicleState[] }>> {
    const res = await this.client.query<{
      vehicle_id: string;
      display_state: string;
      latitude: string | null;
      longitude: string | null;
      driver_name: string | null;
      next_eligible_clock_in_at: string | null;
    }>(
      `SELECT vehicle_id, display_state, latitude, longitude, driver_name, next_eligible_clock_in_at
         FROM app.v_vehicle_display_state`,
    );
    const vehicles: VehicleState[] = res.rows.map((r) => ({
      vehicle_id: r.vehicle_id,
      display_state: r.display_state,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      driver_name: r.driver_name,
      next_eligible_clock_in_at: r.next_eligible_clock_in_at,
    }));
    return ok({ vehicles });
  }
}
