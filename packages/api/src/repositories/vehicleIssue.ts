// packages/api/src/repositories/vehicleIssue.ts
// Driver-reported vehicle issues (14_vehicle_issues.sql). Parameterised SQL only (06 §2); no
// business rules live here. `app.vehicle_issues` is soft-deletable (D3), so BaseRepository's default
// deleted_at handling applies and every read filters on `deleted_at IS NULL`.

import { BaseRepository } from "@fleet/db";
import type { DbClient, VehicleIssueRow } from "@fleet/shared";

/** Read model for `GET /vehicles/{vehicleId}/issues`; aliases match the DTO field names exactly. */
export interface VehicleIssueListRow {
  id: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  category: string;
  severity: string;
  status: string;
  description: string;
  photo_media_object_id: string | null;
  reported_by_driver_id: string;
  reported_by_name: string | null;
  created_at: string;
}

const VEHICLE_ISSUE_SELECT_SQL = `
       i.id                          AS id,
       i.vehicle_id                  AS vehicle_id,
       v.license_plate::text         AS vehicle_plate,
       i.category::text              AS category,
       i.severity::text              AS severity,
       i.status::text                AS status,
       i.description                 AS description,
       i.photo_media_object_id::text AS photo_media_object_id,
       i.reported_by_driver_id       AS reported_by_driver_id,
       u.full_name::text             AS reported_by_name,
       i.created_at                  AS created_at`;

const VEHICLE_ISSUE_JOINS_SQL = `
       FROM app.vehicle_issues i
       LEFT JOIN app.vehicles v ON v.id = i.vehicle_id
       LEFT JOIN app.drivers  d ON d.id = i.reported_by_driver_id
       LEFT JOIN app.users    u ON u.id = d.user_id`;

export class VehicleIssueRepository extends BaseRepository<VehicleIssueRow> {
  constructor(client: DbClient) {
    super(client, "app.vehicle_issues");
  }

  /**
   * Issues raised against one vehicle, keyset paginated on (created_at, id) DESC. Fetches limit + 1
   * rows so `has_more` needs no COUNT (06 §3.1.8).
   */
  async listByVehicle(
    vehicleId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<VehicleIssueListRow[]> {
    const params: unknown[] = [vehicleId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<VehicleIssueListRow>(
      `SELECT ${VEHICLE_ISSUE_SELECT_SQL}
       ${VEHICLE_ISSUE_JOINS_SQL}
        WHERE i.vehicle_id = $1::uuid
          AND i.deleted_at IS NULL ${keyset}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Single issue in the same projection as the list. */
  async findOne(id: string): Promise<VehicleIssueListRow | null> {
    const res = await this.client.query<VehicleIssueListRow>(
      `SELECT ${VEHICLE_ISSUE_SELECT_SQL}
       ${VEHICLE_ISSUE_JOINS_SQL}
        WHERE i.id = $1::uuid
          AND i.deleted_at IS NULL
        LIMIT 1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  /** True when the vehicle exists and is not soft-deleted (guards the FK with a 404, not a 500). */
  async vehicleExists(vehicleId: string): Promise<boolean> {
    const res = await this.client.query<{ ok: number }>(
      `SELECT 1 AS ok FROM app.vehicles WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [vehicleId],
    );
    return res.rows.length > 0;
  }
}
