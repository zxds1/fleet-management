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

/** One row of the driver's DVIR history (B.10). */
export interface DvirSummaryRow {
  inspection_id: string;
  template_label: string;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  status: string;
  submitted_at: string;
  defect_count: number;
  quarantined: boolean;
  block_shift: boolean;
}

/** DVIR detail header (B.12); the per-item rows are fetched separately. */
export interface DvirDetailRow extends DvirSummaryRow {
  vehicle_label: string | null;
  trailer_label: string | null;
  review_note: string | null;
  odometer_km: number | null;
  signature_name: string;
}

/** One checklist result on the DVIR detail screen (B.12). */
export interface DvirDetailItemRow {
  template_item_id: string;
  label: string;
  result: string;
  notes: string | null;
  photo_count: number;
  photo_media_object_id: string | null;
  blocker: boolean;
}

/** One row of a checklist (B.10). Without these the DVIR screen cannot render anything. */
export interface InspectionTemplateItemOption {
  template_item_id: string;
  /** Stable machine code (TIRES, REEFER_TEMP, ...). Used as the result key, never shown raw. */
  code: string;
  label_en: string;
  label_sw: string;
  /** BLOCKER fails ground the asset; WARNING is a recorded defect. */
  severity: "BLOCKER" | "WARNING";
  /** PASS_FAIL items need pass/fail/NA; NUMERIC items need a number (the reefer temperature, M6). */
  input_type: "PASS_FAIL" | "NUMERIC";
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  is_required: boolean;
  sequence: number;
}

/** A checklist the driver may start (B.10). */
export interface InspectionTemplateOption {
  template_id: string;
  name: string;
  label: string;
  subject: string;
  items: InspectionTemplateItemOption[];
}

/**
 * Shared DVIR projection. `status` is derived from the failure flags (the schema has no status
 * column): a BLOCKER failure grounds the asset, a WARNING is a recorded defect, otherwise it
 * passed. `quarantined` reflects a still-open quarantine raised by this inspection (C1.5).
 */
const DVIR_DERIVED_SQL = `
         i.id                        AS inspection_id,
         tpl.name                    AS template_label,
         i.vehicle_id,
         v.license_plate::text       AS vehicle_plate,
         CASE
           WHEN i.has_blocking_failure THEN 'FAILED'
           WHEN i.has_warning_failure  THEN 'DEFECTS'
           ELSE 'PASSED'
         END                         AS status,
         i.performed_at              AS submitted_at,
         coalesce(d.defect_count, 0)::int AS defect_count,
         (q.id IS NOT NULL)          AS quarantined,
         i.has_blocking_failure      AS block_shift`;

/** Failing-item count and the open quarantine raised by this inspection. */
const DVIR_JOINS_SQL = `
    JOIN app.inspection_templates tpl ON tpl.id = i.template_id
    LEFT JOIN app.vehicles v ON v.id = i.vehicle_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS defect_count
        FROM app.inspection_items ii
       WHERE ii.inspection_id = i.id AND ii.result = 'FAIL'
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT qe.id
        FROM app.quarantine_events qe
       WHERE qe.source_inspection_id = i.id AND qe.lifted_at IS NULL
       LIMIT 1
    ) q ON true`;

export class InspectionRepository extends BaseRepository<InspectionRow> {
  constructor(client: DbClient) {
    super(client, "app.inspections", { deletedAtColumn: null });
  }

  /**
   * The caller's own submissions, keyset paginated on (performed_at, id). Always scoped to the
   * caller's driver id so a driver can never read another driver's DVIRs (06 §2).
   */
  async listByDriver(
    driverId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<DvirSummaryRow[]> {
    const params: unknown[] = [driverId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (i.performed_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<DvirSummaryRow>(
      `SELECT ${DVIR_DERIVED_SQL}
         FROM app.inspections i ${DVIR_JOINS_SQL}
        WHERE i.performed_by_driver_id = $1::uuid ${keyset}
        ORDER BY i.performed_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /**
   * Tenant-wide DVIR submissions for the admin review inbox, keyset paginated on (performed_at, id).
   * RLS already fences every row to the caller's tenant; this is the unfiltered company view that an
   * ADMIN/FLEET_MANAGER with inspection:read may see.
   *
   * `driverId` narrows it to that driver's own submissions (the same own-scoping listByDriver and
   * getDetailById apply), which is what the route passes for a caller WITHOUT inspection:template_manage.
   * No `deleted_at` predicate: app.inspections is not soft-deleted — see the constructor.
   */
  async listAll(opts: { limit: number; cursorSort?: string; cursorId?: string; driverId?: string }): Promise<DvirSummaryRow[]> {
    const params: unknown[] = [];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (i.performed_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    // Same own-scoping as getDetailById: a driver without inspection:template_manage sees only their
    // own rows. This is what keeps the tenant-wide list from becoming every driver's DVIR inbox.
    let scope = "";
    if (opts.driverId) {
      params.push(opts.driverId);
      scope = ` AND i.performed_by_driver_id = $${params.length}::uuid`;
    }
    params.push(opts.limit);
    const res = await this.client.query<DvirSummaryRow>(
      `SELECT ${DVIR_DERIVED_SQL}
         FROM app.inspections i ${DVIR_JOINS_SQL}
        WHERE true ${scope} ${keyset}
        ORDER BY i.performed_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /**
   * Single DVIR header. `review_note` and `odometer_km` have no column in this schema, so both are
   * projected as NULL to keep the read model stable for the client contract.
   * `driverId` narrows the lookup to that driver's own submission (C6.2).
   */
  async getDetailById(inspectionId: string, driverId?: string): Promise<DvirDetailRow | null> {
    const params: unknown[] = [inspectionId];
    let scope = "";
    if (driverId) {
      params.push(driverId);
      scope = ` AND i.performed_by_driver_id = $${params.length}::uuid`;
    }
    const res = await this.client.query<DvirDetailRow>(
      `SELECT ${DVIR_DERIVED_SQL},
              v.license_plate::text  AS vehicle_label,
              tr.license_plate::text AS trailer_label,
              NULL::text             AS review_note,
              NULL::int              AS odometer_km,
              i.signature_name
         FROM app.inspections i ${DVIR_JOINS_SQL}
         LEFT JOIN app.trailers tr ON tr.id = i.trailer_id
        WHERE i.id = $1::uuid${scope}
        LIMIT 1`,
      params,
    );
    return res.rows[0] ?? null;
  }
}

export class InspectionItemRepository extends BaseRepository<InspectionItemRow> {
  constructor(client: DbClient) {
    super(client, "app.inspection_items", { deletedAtColumn: null });
  }

  /** Per-item results for the DVIR detail screen, in template order (B.12). */
  async listByInspection(inspectionId: string): Promise<DvirDetailItemRow[]> {
    const res = await this.client.query<DvirDetailItemRow>(
      `SELECT ii.template_item_id::text       AS template_item_id,
              ii.label_snapshot               AS label,
              ii.result::text                 AS result,
              ii.notes,
              coalesce(p.photo_count, 0)::int AS photo_count,
              p.media_object_id::text         AS photo_media_object_id,
              (ii.severity_snapshot = 'BLOCKER') AS blocker
         FROM app.inspection_items ii
         LEFT JOIN LATERAL (
           SELECT count(*) AS photo_count, min(ip.media_object_id::text) AS media_object_id
             FROM app.inspection_item_photos ip
            WHERE ip.inspection_item_id = ii.id
         ) p ON true
         LEFT JOIN app.inspection_template_items ti ON ti.id = ii.template_item_id
        WHERE ii.inspection_id = $1::uuid
        ORDER BY ti.sequence ASC NULLS LAST, ii.item_code ASC`,
      [inspectionId],
    );
    return res.rows;
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

  /**
   * Active, published checklists a driver may start (B.10). Not paginated — the list is small.
   *
   * The items come back with the template because a driver has no other way to learn the checklist:
   * `InspectionTemplateItemRepository` has no read method, so before this the driver received
   * `{ template_id, name, label }` and could not render a single line of the DVIR (E-09).
   */
  async listActive(): Promise<InspectionTemplateOption[]> {
    const templates = await this.client.query<Omit<InspectionTemplateOption, "items">>(
      `SELECT t.id::text AS template_id,
              t.name     AS name,
              t.name     AS label,
              t.subject::text AS subject
         FROM app.inspection_templates t
        WHERE t.is_active = true AND t.published_at IS NOT NULL
        ORDER BY t.subject ASC, t.name ASC`,
    );
    if (templates.rows.length === 0) return [];

    const ids = templates.rows.map((r) => r.template_id);
    const items = await this.client.query<InspectionTemplateItemOption & { template_id: string }>(
      `SELECT template_id::text AS template_id,
              id::text            AS template_item_id,
              code,
              label_en,
              label_sw,
              severity::text      AS severity,
              input_type::text    AS input_type,
              unit,
              min_value::float8   AS min_value,
              max_value::float8   AS max_value,
              is_required,
              sequence
         FROM app.inspection_template_items
        WHERE template_id = ANY($1::uuid[])
        ORDER BY template_id, sequence`,
      [ids as string[]],
    );
    const byTemplate = new Map<string, InspectionTemplateItemOption[]>();
    for (const row of items.rows) {
      const { template_id, ...item } = row;
      const list = byTemplate.get(template_id) ?? [];
      list.push(item);
      byTemplate.set(template_id, list);
    }
    return templates.rows.map((t) => ({ ...t, items: byTemplate.get(t.template_id) ?? [] }));
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



