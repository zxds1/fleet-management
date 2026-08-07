// packages/api/src/services/accidents.ts
// Accident domain (03 §2.4, 08 §3). `mayday` is the B17 escape hatch: it records GPS + reason only,
// bypasses all photo slots, and fires the full escalation immediately (outbox). `create` opens a
// PENDING report whose evidence follows later. `attachMedia` enforces the one-per-report primary
// slots (DB unique index) and is append-only. `acknowledge` cancels the escalation timer (C6.3).
// `verifyChain` reads the SHA-256 hash chain via `fn_verify_accident_chain` (C3.4). Every rule returns
// a Result with a frozen `error_code` (08 §1); DB constraints are the authority.

import {
  conflict,
  err,
  NotFound,
  ok,
  type Result,
  type Tx,
  type ConfigClient,
  type DbClient,
} from "@fleet/shared";
import type { AccidentMediaInput, AccidentCreateInput, MaydayInput } from "@fleet/shared";
import type { AccidentReportRow } from "@fleet/shared";
import {
  AccidentMediaRepository,
  AccidentReportRepository,
  EscalationTimerRepository,
  PRIMARY_MEDIA_SLOTS,
} from "../repositories/accidents";
import type { Actor } from "./shift";

export interface AccidentOutcome {
  accidentId: string;
  escalatedAt?: string;
  acknowledgedAt?: string;
}

export class AccidentService {
  constructor(
    private readonly reports: AccidentReportRepository,
    private readonly media: AccidentMediaRepository,
    private readonly timers: EscalationTimerRepository,
    private readonly config: ConfigClient,
  ) {}

  /** B17 escape hatch: SOS with GPS + reason only, no photos, immediate escalation (03 §2.4, 08 §3). */
  async mayday(
    tx: Tx,
    driverId: string,
    input: MaydayInput,
    actor: Actor,
  ): Promise<Result<AccidentOutcome>> {
    const wasOffShift = input.shift_id == null;
    const report = await this.reports.insertReport({
      driverId,
      shiftId: input.shift_id,
      vehicleId: input.vehicle_id,
      trailerId: null,
      isMayday: true,
      maydayReason: input.mayday_reason,
      occurredAt: null,
      latitude: input.position.latitude,
      longitude: input.position.longitude,
      positionSource: "PHONE_GPS",
      driverStatement: null,
      statementSource: "NOT_PROVIDED",
      witnessName: null,
      witnessPhone: null,
      thirdPartyName: null,
      thirdPartyPhone: null,
      thirdPartyPlate: null,
      thirdPartyInsurer: null,
      policeObNumber: null,
      insuranceClaimNumber: null,
      status: "PENDING",
      telemetryAvailable: false,
      wasOffShift,
    });

    await this.stageEscalationTimer(report.id);
    const escalatedAt = new Date().toISOString();

    tx.audit({
      action: "CREATE",
      entity_table: "app.accident_reports",
      entity_id: report.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/accidents/mayday",
      http_method: "POST",
    });
    // Mayday escalates NOW; the worker processes this event to page on-call + set escalated_at (C6.3).
    tx.registerOutbox({
      event_type: "accident.escalate",
      aggregate_type: "accident_report",
      aggregate_id: report.id,
      payload: { mayday: true, driverId, vehicleId: input.vehicle_id },
    });

    return ok({ accidentId: report.id, escalatedAt });
  }

  /** Open a PENDING report; evidence follows via media / PATCH (03 §2.4). */
  async create(
    tx: Tx,
    driverId: string,
    input: AccidentCreateInput,
    actor: Actor,
  ): Promise<Result<AccidentOutcome>> {
    const wasOffShift = input.shift_id == null;
    const hasPosition = input.position != null;
    const report = await this.reports.insertReport({
      driverId,
      shiftId: input.shift_id ?? null,
      vehicleId: input.vehicle_id ?? null,
      trailerId: input.trailer_id ?? null,
      isMayday: false,
      maydayReason: null,
      occurredAt: input.occurred_at ?? null,
      latitude: hasPosition ? input.position!.latitude : null,
      longitude: hasPosition ? input.position!.longitude : null,
      positionSource: hasPosition ? (input.position_source ?? "PHONE_GPS") : null,
      driverStatement: input.driver_statement ?? null,
      statementSource: input.driver_statement ? "DRIVER" : "NOT_PROVIDED",
      witnessName: input.witness_name ?? null,
      witnessPhone: input.witness_phone ?? null,
      thirdPartyName: input.third_party_name ?? null,
      thirdPartyPhone: input.third_party_phone ?? null,
      thirdPartyPlate: input.third_party_plate ?? null,
      thirdPartyInsurer: input.third_party_insurer ?? null,
      policeObNumber: input.police_ob_number ?? null,
      insuranceClaimNumber: input.insurance_claim_number ?? null,
      status: "PENDING",
      telemetryAvailable: false,
      wasOffShift,
    });

    await this.stageEscalationTimer(report.id);

    tx.audit({
      action: "CREATE",
      entity_table: "app.accident_reports",
      entity_id: report.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/accidents",
      http_method: "POST",
    });
    // Surface the new report to the on-call roster in real time (07 §3, 08 §3). The worker relay
    // publishes `accident:live` for this event.
    tx.registerOutbox({
      event_type: "accident.created",
      aggregate_type: "accident_report",
      aggregate_id: report.id,
      payload: { driverId, vehicleId: input.vehicle_id ?? null },
    });

    return ok({ accidentId: report.id });
  }

  /** Attach media (append-only). Primary slots are one-per-report (DB unique index; pre-checked). */
  async attachMedia(
    tx: Tx,
    reportId: string,
    input: AccidentMediaInput,
    actor: Actor,
  ): Promise<Result<{ attached: true }>> {
    const report = await this.reports.getById(reportId);
    if (!report) return err(new NotFound("Accident report not found"));

    if (PRIMARY_MEDIA_SLOTS.has(input.slot)) {
      const exists = await this.media.existsForSlot(reportId, input.slot);
      if (exists) {
        return err(conflict("DUPLICATE", "Duplicate media slot", `Slot ${input.slot} already attached to this report.`));
      }
    }

    await this.media.insert({
      report_id: reportId,
      slot: input.slot,
      media_object_id: input.media_object_id,
      uploaded_by: actor.userId ?? null,
    });

    tx.audit({
      action: "CREATE",
      entity_table: "app.accident_media",
      entity_id: reportId,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: `/accidents/${reportId}/media`,
      http_method: "POST",
    });
    return ok({ attached: true });
  }

  /** Acknowledge: records the actor + cancels the escalation timer (C6.3). */
  async acknowledge(tx: Tx, reportId: string, actor: Actor): Promise<Result<AccidentOutcome>> {
    const report = await this.reports.getById(reportId);
    if (!report) return err(new NotFound("Accident report not found"));

    const acknowledgedAt = new Date().toISOString();
    await this.reports.update(reportId, {
      acknowledged_by: actor.userId,
      acknowledged_at: acknowledgedAt,
    } as Partial<AccidentReportRow>);
    await this.timers.cancelOpen(reportId, "acknowledged");

    tx.audit({
      action: "UPDATE",
      entity_table: "app.accident_reports",
      entity_id: reportId,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: `/accidents/${reportId}/acknowledge`,
      http_method: "POST",
    });
    return ok({ accidentId: reportId, acknowledgedAt });
  }

  private async stageEscalationTimer(reportId: string): Promise<void> {
    const minutes = await this.config.numeric("accident.ack_timeout_minutes", 5);
    const firesAt = new Date(Date.now() + Math.max(0, minutes) * 60_000).toISOString();
    await this.timers.insertTimer("ACCIDENT", reportId, 1, firesAt);
  }
}

export interface ChainRow {
  sequence: number;
  is_valid: boolean;
  expected_hash: string | null;
  stored_hash: string | null;
}

export class AccidentQuery {
  constructor(private readonly client: DbClient) {}

  /** Returns the per-row validity of the frozen telemetry hash chain (C3.4). Read-only. */
  async verifyChain(
    reportId: string,
  ): Promise<Result<{ all_valid: boolean; rows: ChainRow[] }>> {
    const res = await this.client.query<{
      sequence: number;
      is_valid: boolean;
      expected_hash: Buffer | null;
      stored_hash: Buffer | null;
    }>(`SELECT sequence, is_valid, expected_hash, stored_hash FROM app.fn_verify_accident_chain($1)`, [reportId]);

    const rows: ChainRow[] = res.rows.map((r) => ({
      sequence: r.sequence,
      is_valid: r.is_valid,
      expected_hash: r.expected_hash ? r.expected_hash.toString("hex") : null,
      stored_hash: r.stored_hash ? r.stored_hash.toString("hex") : null,
    }));
    return ok({ all_valid: rows.every((r) => r.is_valid), rows });
  }
}
