// packages/api/src/services/queries.ts
// Read-only query services for the §2.7 insights surface: the unified open-anomaly feed, expiring
// asset documents, and the live vehicle display-state snapshot. All use keyset cursor pagination
// (D7) or a read snapshot; they never mutate and run on a pooled client. `error_code` is the only
// client-branchable member, so a malformed cursor maps to VALIDATION_ERROR (08 §1).

import { type DbClient, type Result, ok, err, NotFound } from "@fleet/shared";
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

/**
 * Detail projection for `GET /anomalies/{id}` (C.14). The mobile client parses this with the shared
 * `AnomalySchema`, so `id`/`domain`/`severity`/`title`/`body`/`created_at` are named and typed for
 * that contract; the remaining fields are the additive detail-screen columns.
 */
export interface AnomalyDetailRow {
  id: string;
  domain: string;
  severity: string;
  title: string;
  body: string;
  created_at: string;
  kind: string;
  status: string;
  recommended_action: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  linked_asset: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  driver_id: string | null;
  driver_name: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  signal: unknown;
}

/**
 * `app.v_open_anomalies.severity` is the DB vocabulary (INFO/WARNING/CRITICAL for fuel, plus the
 * literals the view unions in). The mobile `AnomalySchema` only accepts LOW/MEDIUM/HIGH/CRITICAL,
 * so map across the two rather than leaking a value the client would reject.
 */
function toClientSeverity(severity: string): string {
  switch (severity) {
    case "INFO":
      return "LOW";
    case "WARNING":
      return "MEDIUM";
    case "CRITICAL":
      return "CRITICAL";
    case "LOW":
    case "MEDIUM":
    case "HIGH":
      return severity;
    default:
      return "MEDIUM";
  }
}

/** Human title from the view's `kind` token, e.g. `ACCIDENT_PENDING` → `Accident pending`. */
function titleFromKind(kind: string): string {
  const words = kind.replace(/_/g, " ").toLowerCase().trim();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : kind;
}

/** Pull an optional scalar out of the view's `detail` jsonb without trusting its shape. */
function detailField(detail: unknown, key: string): unknown {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return (detail as Record<string, unknown>)[key];
  }
  return undefined;
}

function detailText(detail: unknown, key: string): string | null {
  const value = detailField(detail, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function detailNumber(detail: unknown, key: string): number | null {
  const value = detailField(detail, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export class AnomalyQuery {
  constructor(private readonly client: DbClient) {}

  /** Cursor page over `app.v_open_anomalies` (fuel/HOS/accident/maintenance/security). Keyset on (detected_at DESC, id DESC).
   * `driverId` narrows the feed to the driver's own anomalies (their rows plus their current
   * vehicle's), so a DRIVER never sees fleet-wide data (B.16). */
  async feed(opts: { domains?: string[]; limit: number; cursor?: string; driverId?: string }): Promise<Result<{ data: AnomalyRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const params: unknown[] = [];
    const where: string[] = [];

    if (opts.domains && opts.domains.length > 0) {
      params.push(opts.domains);
      where.push(`domain = ANY($${params.length}::text[])`);
    }

    if (opts.driverId) {
      params.push(opts.driverId);
      where.push(
        `(driver_id = $${params.length}::uuid
          OR vehicle_id IN (SELECT vehicle_id FROM app.shifts
                             WHERE driver_id = $${params.length}::uuid AND state = 'OPEN'))`,
      );
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

  /**
   * Single anomaly for the admin detail screen (C.14). Reuses the same `app.v_open_anomalies`
   * source as `feed`, keyed by id, and left-joins the vehicle/driver so the screen can label the
   * linked entity. Unknown id → NotFound (404) rather than an empty 200.
   */
  async getAnomaly(id: string): Promise<Result<AnomalyDetailRow>> {
    const res = await this.client.query<{
      domain: string;
      id: string;
      severity: string;
      kind: string;
      vehicle_id: string | null;
      driver_id: string | null;
      detected_at: string;
      detail: unknown;
      vehicle_plate: string | null;
      driver_name: string | null;
    }>(
      `SELECT a.domain, a.id, a.severity, a.kind, a.vehicle_id, a.driver_id, a.detected_at, a.detail,
              v.license_plate AS vehicle_plate,
              u.full_name     AS driver_name
         FROM app.v_open_anomalies a
         LEFT JOIN app.vehicles v ON v.id = a.vehicle_id
         LEFT JOIN app.drivers  d ON d.id = a.driver_id
         LEFT JOIN app.users    u ON u.id = d.user_id
        WHERE a.id = $1::uuid
        LIMIT 1`,
      [id],
    );

    const row = res.rows[0];
    if (!row) return err(new NotFound("Anomaly not found"));

    // The view keeps per-domain facts in `detail`; surface the common ones as first-class fields
    // and still hand the whole object back as `signal` so nothing is lost.
    const latitude = detailNumber(row.detail, "latitude");
    const longitude = detailNumber(row.detail, "longitude");
    const linkedEntityType = row.vehicle_id ? "VEHICLE" : row.driver_id ? "DRIVER" : null;
    const linkedEntityId = row.vehicle_id ?? row.driver_id ?? null;

    return ok({
      id: row.id,
      domain: row.domain,
      severity: toClientSeverity(row.severity),
      title: detailText(row.detail, "title") ?? titleFromKind(row.kind),
      body: detailText(row.detail, "description") ?? detailText(row.detail, "body") ?? "",
      created_at: row.detected_at,
      kind: row.kind,
      // The feed only unions unresolved/unacknowledged records, so anything readable here is open.
      status: "OPEN",
      recommended_action: detailText(row.detail, "recommended_action"),
      linked_entity_type: linkedEntityType,
      linked_entity_id: linkedEntityId,
      linked_asset: row.vehicle_plate ?? row.driver_name ?? null,
      vehicle_id: row.vehicle_id,
      vehicle_plate: row.vehicle_plate,
      driver_id: row.driver_id,
      driver_name: row.driver_name,
      location_text: detailText(row.detail, "location"),
      latitude,
      longitude,
      signal: row.detail ?? null,
    });
  }
}

/** One `key`/`value` pair in the detail screen's metadata table. */
export interface DocumentMetadataEntry {
  key: string;
  value: string | null;
}

/**
 * List projection for `GET /documents/expiring` (B.19). The mobile `DocSummarySchema` reads
 * exactly these fields, so the list must project them (alias `id` → `document_id`, resolve the
 * subject from whichever owner column is set, and compute `days_remaining`) rather than returning
 * raw `asset_documents` columns — see the matching projection in `getDocument`.
 */
export interface DocumentSummaryRow {
  document_id: string;
  document_type: string | null;
  subject_id: string | null;
  subject_name: string | null;
  subject_type: "VEHICLE" | "TRAILER" | "DRIVER" | null;
  linked_asset: string | null;
  expires_on: string | null;
  days_remaining: number | null;
  is_blocking: boolean;
  document_number: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Detail projection for `GET /documents/{id}` (C.16). Superset of the expiring-list row the mobile
 * `DocumentDetailSchema` reads (`document_id`, `document_type`, `subject_id`, `subject_name`,
 * `expires_on`, `days_remaining`, `linked_asset`, `renewal_note`).
 */
export interface DocumentDetailRow {
  document_id: string;
  document_type: string;
  subject_id: string | null;
  subject_name: string | null;
  subject_type: string | null;
  linked_asset: string | null;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  days_remaining: number | null;
  verified_at: string | null;
  document_number: string | null;
  is_blocking: boolean;
  renewal_note: string | null;
  notes: string | null;
  scan_media_id: string | null;
  metadata: DocumentMetadataEntry[];
  created_at: string;
  updated_at: string;
}

export class DocumentQuery {
  constructor(private readonly client: DbClient) {}

  /** Cursor page over `asset_documents` expiring within `withinDays` of today (3.5 / B8). Keyset on (expires_on ASC, id ASC).
   *
   * Returns the `DocumentSummaryRow` projection (matching `getDocument`'s computed columns) so the
   * mobile `DocSummarySchema` receives `document_id`, `subject_id`, `subject_name`, and
   * `days_remaining` rather than raw `asset_documents` columns that lack those names. */
  async expiring(opts: { withinDays: number; limit: number; cursor?: string; driverId?: string }): Promise<Result<{ data: DocumentSummaryRow[]; next_cursor: string | null; has_more: boolean }>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const withinDays = Math.max(0, opts.withinDays);
    const params: unknown[] = [withinDays];
    const where = [
      "d.deleted_at IS NULL",
      "d.superseded_by_id IS NULL",
      "d.expires_on >= current_date",
      `d.expires_on <= (current_date + ($1 || ' days')::interval)`,
    ];

    // A DRIVER only ever sees their own documents plus those of the vehicle they are driving (B.19).
    if (opts.driverId) {
      params.push(opts.driverId);
      where.push(
        `(d.driver_id = $${params.length}::uuid
          OR d.vehicle_id IN (SELECT vehicle_id FROM app.shifts
                             WHERE driver_id = $${params.length}::uuid AND state = 'OPEN'))`,
      );
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(d.expires_on, d.id) > ($${params.length - 1}::date, $${params.length})`);
    }

    const res = await this.client.query<DocumentSummaryRow>(
      `SELECT d.id                 AS document_id,
              d.document_type::text AS document_type,
              d.document_number,
              d.is_blocking,
              d.expires_on,
              (d.expires_on - current_date) AS days_remaining,
              d.created_at,
              d.updated_at,
              d.media_object_id,
              CASE
                WHEN d.vehicle_id IS NOT NULL THEN d.vehicle_id
                WHEN d.trailer_id IS NOT NULL THEN d.trailer_id
                WHEN d.driver_id   IS NOT NULL THEN d.driver_id
                ELSE NULL
              END AS subject_id,
              CASE
                WHEN d.vehicle_id IS NOT NULL THEN 'VEHICLE'::text
                WHEN d.trailer_id IS NOT NULL THEN 'TRAILER'::text
                WHEN d.driver_id   IS NOT NULL THEN 'DRIVER'::text
                ELSE NULL
              END AS subject_type,
              COALESCE(v.license_plate, t.license_plate, u.full_name) AS linked_asset,
              COALESCE(v.license_plate, t.license_plate, u.full_name) AS subject_name
         FROM app.asset_documents d
         LEFT JOIN app.vehicles v ON v.id = d.vehicle_id
         LEFT JOIN app.trailers t ON t.id = d.trailer_id
         LEFT JOIN app.drivers  dr ON dr.id = d.driver_id
         LEFT JOIN app.users    u ON u.id = dr.user_id
         WHERE ${where.join(" AND ")}
         ORDER BY d.expires_on ASC, d.id ASC
         LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    // Subject name is resolved in JS after the keyset page is bounded, so `days_remaining`/`id`
    // drive ordering identically to the detail endpoint.
    const out = res.rows.map((row) => ({
      ...row,
      days_remaining: row.days_remaining != null ? Number(row.days_remaining) : null,
    }));
    const page = buildPage(out, limit, (row) => ({ sort: String(row.expires_on ?? ""), id: row.document_id }));
    return ok(page);
  }

  /**
   * Single document for the admin detail screen (C.16). `app.asset_documents` is the one registry
   * for vehicle/trailer/driver documents (C3.10), so the subject is resolved from whichever owner
   * column is populated. Soft-deleted rows are invisible, matching the list. Unknown id → NotFound.
   */
  async getDocument(id: string): Promise<Result<DocumentDetailRow>> {
    const res = await this.client.query<{
      document_id: string;
      document_type: string;
      document_number: string | null;
      issuer: string | null;
      issued_on: string | null;
      expires_on: string | null;
      days_remaining: string | null;
      is_blocking: boolean;
      notes: string | null;
      media_object_id: string | null;
      superseded_by_id: string | null;
      created_at: string;
      updated_at: string;
      vehicle_id: string | null;
      trailer_id: string | null;
      driver_id: string | null;
      vehicle_plate: string | null;
      trailer_plate: string | null;
      driver_name: string | null;
    }>(
      `SELECT d.id                AS document_id,
              d.document_type::text AS document_type,
              d.document_number,
              d.issuer,
              d.issued_on,
              d.expires_on,
              (d.expires_on - current_date) AS days_remaining,
              d.is_blocking,
              d.notes,
              d.media_object_id,
              d.superseded_by_id,
              d.created_at,
              d.updated_at,
              d.vehicle_id,
              d.trailer_id,
              d.driver_id,
              v.license_plate AS vehicle_plate,
              t.license_plate AS trailer_plate,
              u.full_name     AS driver_name
         FROM app.asset_documents d
         LEFT JOIN app.vehicles v ON v.id = d.vehicle_id
         LEFT JOIN app.trailers t ON t.id = d.trailer_id
         LEFT JOIN app.drivers  dr ON dr.id = d.driver_id
         LEFT JOIN app.users    u ON u.id = dr.user_id
        WHERE d.id = $1::uuid AND d.deleted_at IS NULL
        LIMIT 1`,
      [id],
    );

    const row = res.rows[0];
    if (!row) return err(new NotFound("Document not found"));

    const subjectId = row.vehicle_id ?? row.trailer_id ?? row.driver_id ?? null;
    const subjectName = row.vehicle_plate ?? row.trailer_plate ?? row.driver_name ?? null;
    const subjectType = row.vehicle_id ? "VEHICLE" : row.trailer_id ? "TRAILER" : row.driver_id ? "DRIVER" : null;

    // `notes` doubles as the renewal note on this registry; expose it under both names so the
    // detail screen's `renewal_note` binding resolves without the client re-deriving it.
    return ok({
      document_id: row.document_id,
      document_type: row.document_type,
      subject_id: subjectId,
      subject_name: subjectName,
      subject_type: subjectType,
      linked_asset: subjectName,
      issuer: row.issuer,
      issued_on: row.issued_on,
      expires_on: row.expires_on,
      days_remaining: row.days_remaining != null ? Number(row.days_remaining) : null,
      // The registry supersedes rather than verifies; a still-current row is the verified one.
      verified_at: row.superseded_by_id === null ? row.updated_at : null,
      document_number: row.document_number,
      is_blocking: row.is_blocking,
      renewal_note: row.notes,
      notes: row.notes,
      scan_media_id: row.media_object_id,
      metadata: [
        { key: "document_type", value: row.document_type },
        { key: "document_number", value: row.document_number },
        { key: "issuer", value: row.issuer },
        { key: "issued_on", value: row.issued_on },
        { key: "expires_on", value: row.expires_on },
        { key: "subject_type", value: subjectType },
        { key: "is_blocking", value: String(row.is_blocking) },
      ].filter((entry) => entry.value != null && entry.value !== ""),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  /**
   * Records the admin's renewal note against a document (C.16 detail screen write). The registry
   * has no dedicated renewal column — `app.asset_documents.notes` IS the note, which is why
   * `getDocument` already surfaces it under both `notes` and `renewal_note`. Soft-deleted rows are
   * invisible here exactly as they are in the read, so a deleted document cannot be annotated.
   *
   * Runs on the caller's client, so when invoked inside `executeWrite` the update commits in the
   * same transaction as the audit entry.
   */
  async setRenewalNote(id: string, note: string): Promise<Result<DocumentDetailRow>> {
    const res = await this.client.query<{ id: string }>(
      `UPDATE app.asset_documents
          SET notes = $2, updated_at = now()
        WHERE id = $1::uuid AND deleted_at IS NULL
        RETURNING id`,
      [id, note],
    );
    if (!res.rows[0]) return err(new NotFound("Document not found"));
    // Re-read through the detail projection so the response shape is identical to GET /documents/{id}.
    return this.getDocument(id);
  }
}

export interface VehicleState {
  vehicle_id: string;
  display_state: string;
  latitude: number | null;
  longitude: number | null;
  driver_name: string | null;
  next_eligible_clock_in_at: string | null;
  /** `app.v_vehicle_display_state` names the plate `license_plate`; the contract calls it `plate`. */
  plate: string | null;
  odometer_km: number | null;
  engine_hours: number | null;
  vehicle_class: string | null;
  asset_status: string | null;
  is_online: boolean | null;
  last_position_at: string | null;
  last_speed_kph: number | null;
}

export class DashboardQuery {
  constructor(private readonly client: DbClient) {}

  /** Live map marker snapshot from `app.v_vehicle_display_state` (N5). Not paginated.
   * `driverId` narrows it to the vehicle that driver is currently bound to (B.10).
   *
   * The view carries the marker/identity/telemetry columns; the odometer and engine-hours the
   * dashboard shows live on `app.vehicles` (C4.2), so they are joined in rather than dropped. */
  async vehicleStates(opts: { driverId?: string } = {}): Promise<Result<{ vehicles: VehicleState[] }>> {
    const params: unknown[] = [];
    let whereSql = "";
    if (opts.driverId) {
      params.push(opts.driverId);
      whereSql = ` WHERE s.vehicle_id IN (
                     SELECT vehicle_id FROM app.shifts WHERE driver_id = $1::uuid AND state = 'OPEN'
                     UNION
                     SELECT vehicle_id FROM app.assignments WHERE driver_id = $1::uuid
                   )`;
    }
    const res = await this.client.query<{
      vehicle_id: string;
      display_state: string;
      latitude: string | null;
      longitude: string | null;
      driver_name: string | null;
      next_eligible_clock_in_at: string | null;
      plate: string | null;
      odometer_km: string | null;
      engine_hours: string | null;
      vehicle_class: string | null;
      asset_status: string | null;
      is_online: boolean | null;
      last_position_at: string | null;
      last_speed_kph: string | null;
    }>(
      `SELECT s.vehicle_id,
              s.display_state,
              s.latitude,
              s.longitude,
              s.driver_name,
              s.next_eligible_clock_in_at,
              s.license_plate            AS plate,
              v.current_odometer_km      AS odometer_km,
              v.engine_hours             AS engine_hours,
              s.vehicle_class::text      AS vehicle_class,
              s.asset_status::text       AS asset_status,
              s.is_online,
              s.last_position_at,
              s.last_speed_kph
         FROM app.v_vehicle_display_state s
         LEFT JOIN app.vehicles v ON v.id = s.vehicle_id${whereSql}`,
      params,
    );
    const vehicles: VehicleState[] = res.rows.map((r) => ({
      vehicle_id: r.vehicle_id,
      display_state: r.display_state,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      driver_name: r.driver_name,
      next_eligible_clock_in_at: r.next_eligible_clock_in_at,
      plate: r.plate,
      odometer_km: r.odometer_km != null ? Number(r.odometer_km) : null,
      engine_hours: r.engine_hours != null ? Number(r.engine_hours) : null,
      vehicle_class: r.vehicle_class,
      asset_status: r.asset_status,
      is_online: r.is_online,
      last_position_at: r.last_position_at,
      last_speed_kph: r.last_speed_kph != null ? Number(r.last_speed_kph) : null,
    }));
    return ok({ vehicles });
  }
}
