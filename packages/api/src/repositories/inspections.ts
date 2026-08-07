// packages/api/src/repositories/inspections.ts
// Inspection (DVIR) repositories (05_operations.sql). Parameterised SQL only. `inspections`,
// `inspection_items`, `inspection_item_photos`, templates and `quarantine_events` have no
// `deleted_at`, so each repository opts out of soft-delete (06 §2). The failing-item photo rule is a
// deferred constraint trigger; the service pre-checks it for a clean error_code (08 §1, D3).

import { BaseRepository } from "@fleet/db";
import type {
  DbClient,
  InspectionItemPhotoRow,
  InspectionItemRow,
  InspectionRow,
  InspectionTemplateItemRow,
  InspectionTemplateRow,
  QuarantineEventRow,
} from "@fleet/shared";

export class InspectionRepository extends BaseRepository<InspectionRow> {
  constructor(client: DbClient) {
    super(client, "app.inspections", { deletedAtColumn: null });
  }
}

export class InspectionItemRepository extends BaseRepository<InspectionItemRow> {
  constructor(client: DbClient) {
    super(client, "app.inspection_items", { deletedAtColumn: null });
  }
}

export class InspectionItemPhotoRepository extends BaseRepository<InspectionItemPhotoRow> {
  constructor(client: DbClient) {
    super(client, "app.inspection_item_photos", { deletedAtColumn: null });
  }
}

export class InspectionTemplateRepository extends BaseRepository<InspectionTemplateRow> {
  constructor(client: DbClient) {
    super(client, "app.inspection_templates", { deletedAtColumn: null });
  }
}

export class InspectionTemplateItemRepository extends BaseRepository<InspectionTemplateItemRow> {
  constructor(client: DbClient) {
    super(client, "app.inspection_template_items", { deletedAtColumn: null });
  }
}

export class QuarantineRepository extends BaseRepository<QuarantineEventRow> {
  constructor(client: DbClient) {
    super(client, "app.quarantine_events", { deletedAtColumn: null });
  }

  /** True when the asset already has an open quarantine (the unique index permits only one). */
  async hasOpenForAsset(vehicleId: string | null, trailerId: string | null): Promise<boolean> {
    const res = await this.client.query<{ c: number }>(
      `SELECT 1 AS c FROM app.quarantine_events
        WHERE lifted_at IS NULL AND (vehicle_id = $1 OR trailer_id = $2) LIMIT 1`,
      [vehicleId, trailerId],
    );
    return res.rows.length > 0;
  }
}
