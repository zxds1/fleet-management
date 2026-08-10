// packages/api/src/repositories/trailer.ts
// Trailer assignment repository (05_operations.sql). `trailer_assignments` has no `deleted_at`
// (it is a ledger, D3); `is_active` is a generated column so it is never written. The unique
// partial indexes on `trailer_id`/`vehicle_id` WHERE unassigned_at IS NULL make a double-hook a
// database error; the service pre-checks for a clean error_code (08 §1). Parameterised SQL only.

import { BaseRepository } from "@fleet/db";
import type { DbClient, TrailerAssignmentRow } from "@fleet/shared";

export class TrailerAssignmentRepository extends BaseRepository<TrailerAssignmentRow> {
  constructor(client: DbClient) {
    super(client, "app.trailer_assignments", { deletedAtColumn: null });
  }

  /** The single active (not yet dropped) assignment for a vehicle, if any. */
  async findActiveByVehicle(vehicleId: string): Promise<TrailerAssignmentRow | null> {
    const res = await this.client.query<TrailerAssignmentRow>(
      `SELECT * FROM app.trailer_assignments WHERE vehicle_id = $1 AND unassigned_at IS NULL LIMIT 1`,
      [vehicleId],
    );
    return res.rows[0] ?? null;
  }

  /** The single active assignment for a trailer, if any (used to block double-hook across vehicles). */
  async findActiveByTrailer(trailerId: string): Promise<TrailerAssignmentRow | null> {
    const res = await this.client.query<TrailerAssignmentRow>(
      `SELECT * FROM app.trailer_assignments WHERE trailer_id = $1 AND unassigned_at IS NULL LIMIT 1`,
      [trailerId],
    );
    return res.rows[0] ?? null;
  }
}



