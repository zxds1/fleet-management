// packages/api/src/repositories/accidents.ts
// Accident repositories (08_safety.sql). Parameterised SQL only. `accident_reports` is the system of
// record; `accident_media` and `accident_telemetry` are append-only (triggers reject mutation). The
// five-minute escalation timer (C6.3) is a durable row created in the same transaction as the report.

import { BaseRepository } from "@fleet/db";
import type { AccidentMediaRow, AccidentReportRow, DbClient } from "@fleet/shared";

/** Slots constrained to one-per-report by the `accident_media_unique_primary_slots` index (C5.3). */
export const PRIMARY_MEDIA_SLOTS = new Set<string>([
  "FRONT_DAMAGE",
  "REAR_DAMAGE",
  "SIDE_DAMAGE",
  "OTHER_VEHICLE_PLATE",
  "WITNESS",
]);

export interface NewAccidentReport {
  driverId: string;
  shiftId: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  isMayday: boolean;
  maydayReason: string | null;
  occurredAt: string | null;
  latitude: number | null;
  longitude: number | null;
  positionSource: string | null;
  driverStatement: string | null;
  statementSource: string;
  witnessName: string | null;
  witnessPhone: string | null;
  thirdPartyName: string | null;
  thirdPartyPhone: string | null;
  thirdPartyPlate: string | null;
  thirdPartyInsurer: string | null;
  policeObNumber: string | null;
  insuranceClaimNumber: string | null;
  status: string;
  telemetryAvailable: boolean;
  wasOffShift: boolean;
}

/**
 * Driver/admin accident read model (B.14/B.15). The schema has no `reference`, `severity` or
 * `location_label` column, so all three are derived in SQL: `reference` from the leading id
 * segment (a short, human-quotable handle), `severity` from the mayday flag + status, and
 * `location_label` from the reported lat/long pair. `escalation_tier` comes from the newest
 * still-open escalation timer (C6.3).
 */
export interface AccidentSummaryRow {
  accident_id: string;
  reference: string;
  reported_at: string;
  occurred_at: string | null;
  location_label: string | null;
  severity: string;
  status: string;
  mayday: boolean;
  escalation_tier: number | null;
}

/** Detail row: the summary plus vehicle plate, statement and escalation countdown. */
export interface AccidentDetailRow extends AccidentSummaryRow {
  reported_at: string;
  description: string | null;
  driver_statement: string | null;
  vehicle_label: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  seconds_to_escalation: number | null;
  telemetry_available: boolean;
}

/** Derived columns shared by the summary and detail projections. */
const ACCIDENT_DERIVED_SQL = `
         r.id                                 AS accident_id,
         'ACC-' || upper(left(r.id::text, 8)) AS reference,
         r.reported_at,
         r.occurred_at,
         CASE
           WHEN r.reported_latitude IS NOT NULL AND r.reported_longitude IS NOT NULL
             THEN round(r.reported_latitude, 5)::text || ', ' || round(r.reported_longitude, 5)::text
           ELSE NULL
         END                                  AS location_label,
         CASE
           WHEN r.is_mayday THEN 'CRITICAL'
           WHEN r.status = 'INVESTIGATING' THEN 'MAJOR'
           ELSE 'MINOR'
         END                                  AS severity,
         r.status::text                       AS status,
         r.is_mayday                          AS mayday,
         t.tier::int                          AS escalation_tier`;

/** Newest still-open escalation timer for the report (drives tier + countdown). */
const OPEN_TIMER_JOIN_SQL = `
    LEFT JOIN LATERAL (
      SELECT et.tier, et.fires_at
        FROM app.escalation_timers et
       WHERE et.incident_kind = 'ACCIDENT'
         AND et.incident_id = r.id
         AND et.cancelled_at IS NULL
       ORDER BY et.tier DESC
       LIMIT 1
    ) t ON true`;

export class AccidentReportRepository extends BaseRepository<AccidentReportRow> {
  constructor(client: DbClient) {
    super(client, "app.accident_reports", { deletedAtColumn: null });
  }

  /**
   * Inserts a report with all columns, building the `reported_position` geography from the
   * lat/long pair (parameterised — the only dynamic identifier is the column name from this code,
   * never from request input, 00 §4 invariant 1). `reported_position` is null when no pair is given.
   */
  async insertReport(input: NewAccidentReport): Promise<AccidentReportRow> {
    const cols: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];

    const add = (col: string, value: unknown) => {
      cols.push(col);
      params.push(value);
      placeholders.push(`$${params.length}`);
    };

    add("driver_id", input.driverId);
    add("shift_id", input.shiftId);
    add("vehicle_id", input.vehicleId);
    add("trailer_id", input.trailerId);
    add("is_mayday", input.isMayday);
    add("mayday_reason", input.maydayReason);
    add("was_off_shift", input.wasOffShift);

    if (input.latitude != null && input.longitude != null) {
      cols.push("reported_position");
      params.push(input.longitude, input.latitude);
      placeholders.push(`ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}),4326)::geography`);
    }

    add("reported_latitude", input.latitude);
    add("reported_longitude", input.longitude);
    add("position_source", input.positionSource);
    add("driver_statement", input.driverStatement);
    add("statement_source", input.statementSource);
    add("witness_name", input.witnessName);
    add("witness_phone", input.witnessPhone);
    add("third_party_name", input.thirdPartyName);
    add("third_party_phone", input.thirdPartyPhone);
    add("third_party_plate", input.thirdPartyPlate);
    add("third_party_insurer", input.thirdPartyInsurer);
    add("police_ob_number", input.policeObNumber);
    add("insurance_claim_number", input.insuranceClaimNumber);
    add("status", input.status);
    add("telemetry_available", input.telemetryAvailable);

    const res = await this.client.query<AccidentReportRow>(
      `INSERT INTO app.accident_reports (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      params,
    );
    return res.rows[0] as AccidentReportRow;
  }

  /**
   * The caller's own reports, keyset paginated on (reported_at, id). Always scoped to the caller's
   * driver id so a driver can never read another driver's reports (06 §2).
   */
  async listByDriver(
    driverId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<AccidentSummaryRow[]> {
    const params: unknown[] = [driverId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (r.reported_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<AccidentSummaryRow>(
      `SELECT ${ACCIDENT_DERIVED_SQL}
         FROM app.accident_reports r ${OPEN_TIMER_JOIN_SQL}
        WHERE r.driver_id = $1::uuid ${keyset}
        ORDER BY r.reported_at DESC, r.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /**
   * Single report detail joined with the vehicle plate and escalation countdown (B.15).
   * `driverId` narrows the lookup to that driver's own report, so an unprivileged caller can
   * never read another driver's accident by guessing an id (C6.2).
   */
  async getDetailById(reportId: string, driverId?: string): Promise<AccidentDetailRow | null> {
    const params: unknown[] = [reportId];
    let scope = "";
    if (driverId) {
      params.push(driverId);
      scope = ` AND r.driver_id = $${params.length}::uuid`;
    }
    const res = await this.client.query<AccidentDetailRow>(
      `SELECT ${ACCIDENT_DERIVED_SQL},
              r.reported_at,
              r.mayday_reason         AS description,
              r.driver_statement,
              v.license_plate::text   AS vehicle_label,
              r.acknowledged_by::text AS acknowledged_by,
              r.acknowledged_at,
              CASE
                WHEN r.acknowledged_at IS NOT NULL OR t.fires_at IS NULL THEN NULL
                ELSE greatest(0, floor(extract(epoch FROM (t.fires_at - now()))))::int
              END                     AS seconds_to_escalation,
              r.telemetry_available
         FROM app.accident_reports r
         LEFT JOIN app.vehicles v ON v.id = r.vehicle_id ${OPEN_TIMER_JOIN_SQL}
        WHERE r.id = $1::uuid${scope}
        LIMIT 1`,
      params,
    );
    return res.rows[0] ?? null;
  }
}

export class AccidentMediaRepository extends BaseRepository<AccidentMediaRow> {
  constructor(client: DbClient) {
    super(client, "app.accident_media", { deletedAtColumn: null });
  }

  /** True when a primary (one-per-report) slot already has a row for this report. */
  async existsForSlot(reportId: string, slot: string): Promise<boolean> {
    const res = await this.client.query<{ c: number }>(
      `SELECT 1 AS c FROM app.accident_media WHERE report_id = $1 AND slot = $2 LIMIT 1`,
      [reportId, slot],
    );
    return res.rows.length > 0;
  }

  /** Media gallery for the detail screen, in capture order. */
  async listByReport(reportId: string): Promise<{ media_id: string; slot: string; kind: string }[]> {
    const res = await this.client.query<{ media_id: string; slot: string; kind: string }>(
      `SELECT m.media_object_id::text AS media_id,
              m.slot::text            AS slot,
              'PHOTO'                 AS kind
         FROM app.accident_media m
        WHERE m.report_id = $1::uuid
        ORDER BY m.uploaded_at ASC, m.id ASC`,
      [reportId],
    );
    return res.rows;
  }
}

export class EscalationTimerRepository extends BaseRepository {
  constructor(client: DbClient) {
    super(client, "app.escalation_timers", { deletedAtColumn: null });
  }

  async insertTimer(incidentKind: string, incidentId: string, tier: number, firesAt: string): Promise<void> {
    await this.client.query(
      `INSERT INTO app.escalation_timers (incident_kind, incident_id, tier, fires_at)
       VALUES ($1, $2, $3, $4)`,
      [incidentKind, incidentId, tier, firesAt],
    );
  }

  /** Cancels any open timers for the incident (C6.3: acknowledgement cancels escalation). */
  async cancelOpen(incidentId: string, reason: string): Promise<void> {
    await this.client.query(
      `UPDATE app.escalation_timers
         SET cancelled_at = now(), cancelled_reason = $2
       WHERE incident_kind = 'ACCIDENT' AND incident_id = $1 AND cancelled_at IS NULL`,
      [incidentId, reason],
    );
  }
}


