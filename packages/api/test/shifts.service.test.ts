// packages/api/test/shifts.service.test.ts
// Unit tests for ShiftService.clockIn using fakes (no DB). Covers the frozen error_code paths
// from 08 §1: NO_ASSIGNMENT, ODOMETER_DECREASED, CONSENT_REQUIRED, SHIFT_ALREADY_OPEN,
// CLOCKOUT_PENDING, HOS_REST_BLOCKED, and the happy path.

import { ok, err, type Result, type Tx, type DbClient } from "@fleet/shared";
import { ConsentRequired, NotFound, Forbidden } from "@fleet/shared";
import { ShiftService } from "../src/services/shift";
import type { AssignmentRow, ShiftRow, VehicleRow } from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

function makeService(state: {
  assignment?: AssignmentRow | null;
  vehicle?: VehicleRow | null;
  consent?: boolean;
  openShift?: ShiftRow | null;
  pending?: ShiftRow | null;
  hosBlocked?: boolean;
  insertedShiftId?: string;
}) {
  const assignments = {
    getById: async (id: string) => (state.assignment && (state.assignment as AssignmentRow).id === id ? state.assignment : null),
  } as unknown as import("../src/repositories/shifts").AssignmentRepository;

  const vehicles = {
    getById: async () => state.vehicle ?? null,
  } as unknown as import("../src/repositories/shifts").VehicleRepository;

  const consents = {
    findAccepted: async () => (state.consent ? ({} as never) : null),
  } as unknown as import("../src/repositories/identity").ConsentRepository;

  const shifts = {
    getById: async () => null,
    findOpenByDriver: async () => state.openShift ?? null,
    findPendingCloseoutByDriver: async () => state.pending ?? null,
    insert: async () => ({ id: state.insertedShiftId ?? "shift-1", clock_in_at: new Date().toISOString() } as ShiftRow),
    update: async () => ({}) as ShiftRow,
  } as unknown as import("../src/repositories/shifts").ShiftRepository;

  const hos = {
    getState: async () =>
      state.hosBlocked
        ? ({ next_eligible_clock_in_at: new Date(Date.now() + 3600_000).toISOString() } as never)
        : null,
  } as unknown as import("../src/repositories/shifts").HosRepository;

  const fuel = { insert: async () => ({}) as never } as unknown as import("../src/repositories/shifts").FuelRecordRepository;
  const workLogs = {} as unknown as import("../src/repositories/shifts").WorkLogRepository;

  return new ShiftService(shifts, assignments, vehicles, fuel, workLogs, hos, consents);
}

const baseInput = {
  assignment_id: "assign-1",
  start_odometer_km: 1000,
  start_fuel_gauge: "HALF" as const,
  start_media_object_id: "media-1",
  phone_gps_fallback_enabled: false,
  consent_version: "v1",
};
const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };

describe("ShiftService.clockIn", () => {
  it("returns NO_ASSIGNMENT when the assignment is missing/cancelled", async () => {
    const svc = makeService({ assignment: null });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("NO_ASSIGNMENT");
  });

  it("returns ODOMETER_DECREASED when start < vehicle last reading", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1" } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 1200 } as VehicleRow,
      consent: true,
    });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("ODOMETER_DECREASED");
  });

  it("returns CONSENT_REQUIRED when GPS tracking consent is absent", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1" } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 900 } as VehicleRow,
      consent: false,
    });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ConsentRequired);
  });

  it("returns SHIFT_ALREADY_OPEN when a shift is open", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1" } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 900 } as VehicleRow,
      consent: true,
      openShift: { id: "open-1" } as ShiftRow,
    });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("SHIFT_ALREADY_OPEN");
  });

  it("returns CLOCKOUT_PENDING when a shift awaits close-out", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1" } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 900 } as VehicleRow,
      consent: true,
      pending: { id: "pending-1" } as ShiftRow,
    });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("CLOCKOUT_PENDING");
  });

  it("returns HOS_REST_BLOCKED when rest is incomplete", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1" } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 900 } as VehicleRow,
      consent: true,
      hosBlocked: true,
    });
    const r = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("HOS_REST_BLOCKED");
  });

  it("opens a shift on the happy path", async () => {
    const svc = makeService({
      assignment: { id: "assign-1", vehicle_id: "veh-1", trailer_id: null } as AssignmentRow,
      vehicle: { id: "veh-1", current_odometer_km: 900 } as VehicleRow,
      consent: true,
      insertedShiftId: "new-shift",
    });
    const r: Result<{ shiftId: string }> = await svc.clockIn(tx, "driver-1", baseInput, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.shiftId).toBe("new-shift");
  });

  void ok; void err; void NotFound; void Forbidden;
});
