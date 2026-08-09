// packages/api/test/maintenance.service.test.ts
// Unit tests for MaintenanceService using hand-rolled fakes (no DB). Covers the work-order
// invariants: exactly one asset (MAINTENANCE_ASSET_REQUIRED), the task code must resolve to an
// active catalogue row (MAINTENANCE_TASK_UNKNOWN), the task must apply to the asset kind
// (MAINTENANCE_TASK_ASSET_MISMATCH), and the happy path inserts + stages an outbox event. Also
// covers the list keyset envelope and the NotFound detail branch.

import { type DbClient, type Tx } from "@fleet/shared";
import type { MaintenanceRecordRow, MaintenanceTaskRow } from "@fleet/shared";
import { MaintenanceService } from "../src/services/maintenance";
import type { MaintenanceListRow } from "../src/repositories/maintenance";

const outbox: unknown[] = [];
const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: (e: unknown) => void outbox.push(e),
} as unknown as Tx;

const actor = { userId: "usr-1" };

const vehicleTask = {
  id: "task-1",
  code: "OIL_CHANGE",
  name: "Oil change",
  applies_to: "VEHICLE",
  is_active: true,
} as unknown as MaintenanceTaskRow;

function makeService(
  overrides: {
    task?: MaintenanceTaskRow | null;
    records?: MaintenanceListRow[];
    record?: MaintenanceListRow | null;
  } = {},
) {
  const inserted: Record<string, unknown>[] = [];

  const records = {
    insert: async (row: Record<string, unknown>) => {
      inserted.push(row);
      return { id: "mr-1", performed_at: row.performed_at } as unknown as MaintenanceRecordRow;
    },
    listRecords: async () => overrides.records ?? [],
    findRecord: async () => (overrides.record !== undefined ? overrides.record : null),
  } as unknown as import("../src/repositories/maintenance").MaintenanceRecordRepository;

  const tasks = {
    findActiveByCode: async () => (overrides.task !== undefined ? overrides.task : vehicleTask),
  } as unknown as import("../src/repositories/maintenance").MaintenanceTaskRepository;

  return { service: new MaintenanceService(records, tasks), inserted };
}

const baseInput = {
  task_code: "OIL_CHANGE",
  performed_at: "2026-01-05T08:00:00.000Z",
};

describe("MaintenanceService.createWorkOrder", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("rejects a work order with neither vehicle_id nor trailer_id", async () => {
    const { service } = makeService();
    const result = await service.createWorkOrder(tx, { ...baseInput }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("MAINTENANCE_ASSET_REQUIRED");
  });

  it("rejects a work order naming both a vehicle and a trailer", async () => {
    const { service } = makeService();
    const result = await service.createWorkOrder(
      tx,
      { ...baseInput, vehicle_id: "veh-1", trailer_id: "trl-1" },
      actor,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("MAINTENANCE_ASSET_REQUIRED");
  });

  it("rejects an unknown or inactive task code", async () => {
    const { service } = makeService({ task: null });
    const result = await service.createWorkOrder(tx, { ...baseInput, vehicle_id: "veh-1" }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("MAINTENANCE_TASK_UNKNOWN");
  });

  it("rejects a VEHICLE task booked against a trailer", async () => {
    const { service } = makeService();
    const result = await service.createWorkOrder(tx, { ...baseInput, trailer_id: "trl-1" }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("MAINTENANCE_TASK_ASSET_MISMATCH");
  });

  it("inserts the record and stages an outbox event on the happy path", async () => {
    const { service, inserted } = makeService();
    const result = await service.createWorkOrder(
      tx,
      { ...baseInput, vehicle_id: "veh-1", cost: 4500, odometer_km: 120_000 },
      actor,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("mr-1");
    expect(inserted).toHaveLength(1);
    // cost is a numeric column: it must reach the driver as a string, not a float.
    expect(inserted[0]).toMatchObject({ task_id: "task-1", vehicle_id: "veh-1", trailer_id: null, cost: "4500", recorded_by: "usr-1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ event_type: "maintenance.work_order.created", aggregate_id: "mr-1" });
  });
});

describe("MaintenanceService reads", () => {
  const row: MaintenanceListRow = {
    id: "mr-1",
    vehicle_plate: "KDA 001A",
    task_name: "Oil change",
    performed_at: "2026-01-05T08:00:00.000Z",
    odometer_km: 120_000,
    cost: "4500.00",
    vendor: "Acme",
  };

  it("returns a cursor page and truncates the limit+1 probe row", async () => {
    const { service } = makeService({ records: [row, { ...row, id: "mr-2" }] });
    const result = await service.list({ limit: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(1);
      expect(result.value.has_more).toBe(true);
      expect(result.value.next_cursor).not.toBeNull();
    }
  });

  it("maps an unknown id to NOT_FOUND", async () => {
    const { service } = makeService({ record: null });
    const result = await service.getOne("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("returns the record when it exists", async () => {
    const { service } = makeService({ record: row });
    const result = await service.getOne("mr-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.task_name).toBe("Oil change");
  });
});
