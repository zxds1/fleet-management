// packages/api/src/services/shift.ts
// Shift domain (03 §2.2, 08 §2). Every rule returns a Result with a frozen `error_code`
// (08 §1); the DB constraints are the final authority (defence in depth). The handler runs
// each method inside executeWrite so audit + outbox commit with the mutation (D8).

import {
  conflict,
  err,
  Forbidden,
  NotFound,
  ok,
  type Result,
  type Tx,
  violation,
} from "@fleet/shared";
import type { ClockInInput, ClockOutInput, ConsentType, VerifyShiftInput, WorkPlan } from "@fleet/shared";
import { ConsentRequired } from "@fleet/shared";
import type {
  AssignmentRow,
  ShiftRow,
  ShiftVerificationInboxViewRow,
  VehicleRow,
} from "@fleet/shared";
import type { CursorPage } from "../http/pagination";
import { buildPage, decodeCursor, encodeCursor, resolveSortColumn, MAX_PAGE_LIMIT } from "../http/pagination";
import {
  AssignmentRepository,
  FuelRecordRepository,
  HosRepository,
  ShiftRepository,
  VehicleRepository,
  WorkLogRepository,
} from "../repositories/shifts";
import type { ShiftHistoryRow } from "../repositories/shifts";
import { ConsentRepository } from "../repositories/identity";

export interface Actor {
  userId: string;
  email?: string;
  roles?: string[];
}

export interface ClockInOutcome {
  shiftId: string;
  clockInAt: string;
  disclaimer: string;
}

const GPS_CONSENT: ConsentType = "GPS_TRACKING_WORKING_HOURS";

export class ShiftService {
  constructor(
    private readonly shifts: ShiftRepository,
    private readonly assignments: AssignmentRepository,
    private readonly vehicles: VehicleRepository,
    private readonly fuel: FuelRecordRepository,
    private readonly workLogs: WorkLogRepository,
    private readonly hos: HosRepository,
    private readonly consents: ConsentRepository,
  ) {}

  async clockIn(tx: Tx, driverId: string, input: ClockInInput, actor: Actor): Promise<Result<ClockInOutcome>> {
    const assignment = await this.assignments.getById(input.assignment_id);
    if (!assignment || assignment.status === "CANCELLED") {
      return err(conflict("NO_ASSIGNMENT", "No active assignment", "Clock-in requires a non-cancelled assignment (C1.8)."));
    }

    const vehicle = await this.vehicles.getById(assignment.vehicle_id);
    if (!vehicle) return err(new NotFound("Vehicle not found"));
    if (vehicle.current_odometer_km != null && input.start_odometer_km < vehicle.current_odometer_km) {
      return err(violation("ODOMETER_DECREASED", "Odometer decreased", "Start odometer is below the vehicle's last reading (C4.2)."));
    }

    const consent = await this.consents.findAccepted(driverId, GPS_CONSENT);
    if (!consent) return err(new ConsentRequired());

    if (await this.shifts.findOpenByDriver(driverId)) {
      return err(conflict("SHIFT_ALREADY_OPEN", "Shift already open", "Driver already has an OPEN shift."));
    }
    if (await this.shifts.findPendingCloseoutByDriver(driverId)) {
      return err(conflict("CLOCKOUT_PENDING", "Close-out pending", "Resolve the outstanding end-of-shift evidence first (B7)."));
    }

    const hosState = await this.hos.getState(driverId);
    if (hosState?.next_eligible_clock_in_at && new Date(hosState.next_eligible_clock_in_at).getTime() > Date.now()) {
      return err(violation("HOS_REST_BLOCKED", "HOS rest incomplete", "Required rest has not elapsed (C3.3)."));
    }

    const now = new Date();
    const shift = await this.shifts.insert({
      driver_id: driverId,
      vehicle_id: assignment.vehicle_id,
      assigned_trailer_id: assignment.trailer_id,
      assignment_id: assignment.id,
      clock_in_at: now,
      clock_in_source: "DRIVER",
      start_odometer_km: input.start_odometer_km,
      start_fuel_gauge: input.start_fuel_gauge,
      phone_gps_fallback_enabled: input.phone_gps_fallback_enabled,
      distance_source: "UNAVAILABLE",
    });

     await this.fuel.insert({
       shift_id: shift.id,
       vehicle_id: assignment.vehicle_id,
       driver_id: driverId,
       purpose: "SHIFT_START",
       media_object_id: input.start_media_object_id,
       odometer_km: input.start_odometer_km,
       gauge_level: input.start_fuel_gauge,
     });

     if (input.planned_notes || (input.work_plan_media_object_ids?.length ?? 0) > 0) {
       await this.workLogs.insertWithPhotos(
         { shift_id: shift.id, planned_notes: input.planned_notes ?? null, debrief_notes: null },
         input.work_plan_media_object_ids ?? [],
       );
     } else {
       await this.workLogs.insert({ shift_id: shift.id, planned_notes: null, debrief_notes: null });
     }

    tx.audit({
      action: "CREATE",
      entity_table: "app.shifts",
      entity_id: shift.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/shifts/clock-in",
      http_method: "POST",
    });
    tx.registerOutbox({
      event_type: "shift.started",
      aggregate_type: "shift",
      aggregate_id: shift.id,
      payload: { driverId, vehicleId: assignment.vehicle_id, assignmentId: assignment.id },
    });

    return ok({
      shiftId: shift.id,
      clockInAt: now.toISOString(),
      disclaimer: "By clocking in you confirm the odometer and fuel-gauge readings are accurate (C4.2).",
    });
  }

  async clockOut(tx: Tx, driverId: string, input: ClockOutInput, actor: Actor): Promise<Result<{ shiftId: string }>> {
    const shift = await this.shifts.getById(input.shift_id);
    if (!shift) return err(new NotFound("Shift not found"));
    if (shift.driver_id !== driverId) return err(new Forbidden("You may only close your own shift"));
    if (shift.state !== "OPEN") return err(conflict("DUPLICATE", "Shift not open", "This shift is not open for clock-out."));
    if (input.end_odometer_km < shift.start_odometer_km) {
      return err(violation("ODOMETER_DECREASED", "Odometer decreased", "End odometer is below the start reading (C4.2)."));
    }

    const now = new Date();
    const clockInAt = new Date(shift.clock_in_at);
    const durationSeconds = Math.max(0, Math.round((now.getTime() - clockInAt.getTime()) / 1000));
    const distanceKm = Number((input.end_odometer_km - shift.start_odometer_km).toFixed(2));

    await this.fuel.insert({
      shift_id: shift.id,
      vehicle_id: shift.vehicle_id,
      driver_id: driverId,
      purpose: "SHIFT_END",
      media_object_id: input.end_media_object_id,
      odometer_km: input.end_odometer_km,
      gauge_level: input.end_fuel_gauge,
    });

    const closed = await this.shifts.update(shift.id, {
      clock_out_at: now.toISOString(),
      clock_out_source: "DRIVER",
      clock_out_by: driverId,
      end_odometer_km: input.end_odometer_km,
      end_fuel_gauge: input.end_fuel_gauge,
      total_distance_km: String(distanceKm),
      shift_duration_seconds: durationSeconds,
      distance_source: "ODOMETER",
      state: "CLOSED",
      closeout_missing: [],
    });

     if (input.debrief_notes && input.debrief_notes.trim().length > 0) {
       await this.workLogs.upsertDebrief(shift.id, input.debrief_notes);
     }

    tx.audit({
      action: "UPDATE",
      entity_table: "app.shifts",
      entity_id: shift.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/shifts/clock-out",
      http_method: "POST",
    });
    tx.registerOutbox({
      event_type: "shift.closed",
      aggregate_type: "shift",
      aggregate_id: shift.id,
      payload: { driverId, distanceKm, durationSeconds },
    });

    void closed;
    return ok({ shiftId: shift.id });
  }

  async verify(tx: Tx, shiftId: string, input: VerifyShiftInput, actor: Actor): Promise<Result<{ shiftId: string; status: string }>> {
    const shift = await this.shifts.getById(shiftId);
    if (!shift) return err(new NotFound("Shift not found"));

    if (input.corrected_end_odometer_km != null && shift.verification_status === "VERIFIED" && shift.unlocked_at == null) {
      return err(conflict("UNLOCK_REQUIRED", "Unlock required", "Edit a verified shift only after UNLOCK_FOR_CORRECTION (B18)."));
    }

    const now = new Date();
    const patch: Partial<ShiftRow> = {};
    if (input.action === "VERIFY") {
      patch.verification_status = "VERIFIED";
      patch.verified_by = actor.userId;
      patch.verified_at = now.toISOString();
      patch.locked_at = now.toISOString();
      patch.flag_reason = null;
    } else {
      patch.verification_status = "FLAGGED";
      patch.flag_reason = input.flag_reason ?? "Flagged by reviewer";
    }
    if (input.corrected_end_odometer_km != null) {
      patch.end_odometer_km = input.corrected_end_odometer_km;
      patch.corrected_at = now.toISOString();
      patch.corrected_by = actor.userId;
      patch.correction_reason = "Corrected end odometer after unlock (B18)";
    }

    await this.shifts.update(shift.id, patch);
    tx.audit({
      action: "VERIFY",
      entity_table: "app.shifts",
      entity_id: shift.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/shifts/{id}/verify",
      http_method: "POST",
      reason: input.action,
    });
    return ok({ shiftId: shift.id, status: patch.verification_status as string });
  }

  async forceClose(tx: Tx, shiftId: string, actor: Actor, reason: string): Promise<Result<{ shiftId: string }>> {
    const shift = await this.shifts.getById(shiftId);
    if (!shift) return err(new NotFound("Shift not found"));

    const now = new Date();
    await this.shifts.update(shift.id, {
      state: "CLOSED",
      clock_out_at: shift.clock_out_at ?? now.toISOString(),
      clock_out_source: shift.clock_out_source ?? "ADMIN_OVERRIDE",
      clock_out_by: actor.userId,
      closeout_missing: [],
    });
    tx.audit({
      action: "OVERRIDE",
      entity_table: "app.shifts",
      entity_id: shift.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/shifts/{id}/force-close",
      http_method: "POST",
      reason: reason || "Admin force-close (N6/C3.8)",
    });
    return ok({ shiftId: shift.id });
  }

  async getActive(driverId: string): Promise<ShiftRow | null> {
    return this.shifts.findOpenByDriver(driverId);
  }

  async getWorkPlan(shiftId: string): Promise<WorkPlan | null> {
    return this.workLogs.getForShift(shiftId);
  }
}

const INBOX_SORT = {
  clock_out_at: "clock_out_at",
  operational_date: "operational_date",
  verification_status: "verification_status",
} as const;

export class ShiftQuery {
  constructor(private readonly shifts: ShiftRepository) {}

  /** Cursor page over `v_shift_verification_inbox` (03 §2.2, D7). */
  async verificationInbox(opts: {
    verificationStatus?: string;
    state?: string;
    operationalDate?: string;
    sort?: string;
    limit: number;
    cursor?: string;
  }): Promise<Result<CursorPage<ShiftVerificationInboxViewRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const sortColumn = resolveSortColumn(INBOX_SORT, opts.sort, "clock_out_at");
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.verificationStatus) {
      params.push(opts.verificationStatus);
      where.push(`verification_status = $${params.length}`);
    }
    if (opts.state) {
      params.push(opts.state);
      where.push(`state = $${params.length}`);
    }
    if (opts.operationalDate) {
      params.push(opts.operationalDate);
      where.push(`operational_date = $${params.length}`);
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(`(clock_out_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const res = await this.shifts.dbClient.query<ShiftVerificationInboxViewRow>(
      `SELECT * FROM app.v_shift_verification_inbox ${whereSql}
       ORDER BY ${sortColumn} DESC, id DESC
       LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const page = buildPage(res.rows, limit, (row) => ({
      sort: String(row.clock_out_at ?? ""),
      id: row.shift_id ?? "",
    }));
    void encodeCursor;
    return ok(page);
  }

  /** Cursor page over the caller's own shift history (03 §2.2, D7). */
  async listHistory(driverId: string, opts: { limit: number; cursor?: string }): Promise<Result<CursorPage<ShiftHistoryRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor);
    const rows = await this.shifts.listHistoryByDriver(driverId, {
      limit: limit + 1,
      cursorSort: cursor?.sort,
      cursorId: cursor?.id,
    });
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.clock_in_at ?? ""), id: row.shift_id })));
  }

  /** Verification detail for one shift; NotFound when the id is unknown. */
  async getVerification(shiftId: string): Promise<Result<ShiftVerificationInboxViewRow>> {
    const row = await this.shifts.getVerificationById(shiftId);
    if (!row) return err(new NotFound("Shift not found"));
    return ok(row);
  }
}
