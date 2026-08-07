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
