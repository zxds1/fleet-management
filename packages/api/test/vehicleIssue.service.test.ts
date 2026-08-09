// packages/api/test/vehicleIssue.service.test.ts
// Unit tests for VehicleIssueService using hand-rolled fakes (no DB, no jest mocks — the repository
// is an object literal double-cast through `unknown`, matching the house pattern). Covers:
//   • unknown vehicle → NOT_FOUND (never a raw FK 500)
//   • blank/whitespace description → VEHICLE_ISSUE_DESCRIPTION_REQUIRED (branchable 422)
//   • happy path → inserts an OPEN row scoped to the calling driver + stages the outbox event
//   • getForVehicle → keyset envelope, has_more, and the NotFound branch
//   • getOne → NotFound on an unknown id

import { type DbClient, type Tx } from "@fleet/shared";
import type { VehicleIssueRow } from "@fleet/shared";
import { VehicleIssueService } from "../src/services/vehicleIssue";
import type { VehicleIssueListRow } from "../src/repositories/vehicleIssue";

const VEHICLE_ID = "11111111-1111-4111-8111-111111111111";
const DRIVER_ID = "22222222-2222-4222-8222-222222222222";

function makeTx(outbox: unknown[]): Tx {
  return {
    client: {} as DbClient,
    audit: () => undefined,
    registerOutbox: (e: unknown) => void outbox.push(e),
  } as unknown as Tx;
}

function listRow(id: string, createdAt: string): VehicleIssueListRow {
  return {
    id,
    vehicle_id: VEHICLE_ID,
    vehicle_plate: "KDA 001A",
    category: "MECHANICAL",
    severity: "LOW",
    status: "OPEN",
    description: "Knocking sound",
    photo_media_object_id: null,
    reported_by_driver_id: DRIVER_ID,
    reported_by_name: "Asha P.",
    created_at: createdAt,
  };
}

function makeService(
  overrides: {
    vehicleExists?: boolean;
    rows?: VehicleIssueListRow[];
    one?: VehicleIssueListRow | null;
  } = {},
) {
  const inserted: Record<string, unknown>[] = [];

  const issues = {
    vehicleExists: async () => overrides.vehicleExists ?? true,
    insert: async (row: Record<string, unknown>) => {
      inserted.push(row);
      return {
        id: "vi-1",
        vehicle_id: row.vehicle_id,
        category: row.category,
        severity: row.severity,
        status: row.status,
        created_at: "2026-02-01T06:00:00.000Z",
      } as unknown as VehicleIssueRow;
    },
    listByVehicle: async () => overrides.rows ?? [],
    findOne: async () => (overrides.one !== undefined ? overrides.one : null),
  } as unknown as import("../src/repositories/vehicleIssue").VehicleIssueRepository;

  return { service: new VehicleIssueService(issues), inserted };
}

const baseInput = {
  category: "MECHANICAL" as const,
  severity: "LOW" as const,
  description: "Knocking sound from the front left wheel",
};

describe("VehicleIssueService.report", () => {
  it("returns NOT_FOUND for an unknown vehicle", async () => {
    const { service } = makeService({ vehicleExists: false });
    const result = await service.report(makeTx([]), VEHICLE_ID, DRIVER_ID, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("rejects a whitespace-only description", async () => {
    const { service } = makeService();
    const result = await service.report(makeTx([]), VEHICLE_ID, DRIVER_ID, {
      ...baseInput,
      description: "    ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("VEHICLE_ISSUE_DESCRIPTION_REQUIRED");
  });

  it("inserts an OPEN issue scoped to the calling driver and stages the outbox event", async () => {
    const outbox: unknown[] = [];
    const { service, inserted } = makeService();
    const result = await service.report(makeTx(outbox), VEHICLE_ID, DRIVER_ID, {
      ...baseInput,
      severity: "HIGH",
      description: "  Brake warning light is on  ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.issue_id).toBe("vi-1");
      expect(result.value.status).toBe("OPEN");
      expect(result.value.severity).toBe("HIGH");
    }

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      vehicle_id: VEHICLE_ID,
      reported_by_driver_id: DRIVER_ID,
      category: "MECHANICAL",
      severity: "HIGH",
      status: "OPEN",
      // trimmed before it reaches the DB CHECK
      description: "Brake warning light is on",
      shift_id: null,
      photo_media_object_id: null,
    });

    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: "vehicle.issue.reported",
      aggregate_type: "vehicle_issue",
      aggregate_id: "vi-1",
    });
  });

  it("carries the optional shift and photo through to the row", async () => {
    const shiftId = "33333333-3333-4333-8333-333333333333";
    const photoId = "44444444-4444-4444-8444-444444444444";
    const { service, inserted } = makeService();
    const result = await service.report(makeTx([]), VEHICLE_ID, DRIVER_ID, {
      ...baseInput,
      shift_id: shiftId,
      photo_media_object_id: photoId,
    });
    expect(result.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ shift_id: shiftId, photo_media_object_id: photoId });
  });
});

describe("VehicleIssueService.getForVehicle", () => {
  it("returns NOT_FOUND for an unknown vehicle", async () => {
    const { service } = makeService({ vehicleExists: false });
    const result = await service.getForVehicle(VEHICLE_ID, { limit: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("builds a cursor page and flags has_more when the repository over-fetches", async () => {
    const rows = [
      listRow("vi-3", "2026-02-03T06:00:00.000Z"),
      listRow("vi-2", "2026-02-02T06:00:00.000Z"),
      listRow("vi-1", "2026-02-01T06:00:00.000Z"),
    ];
    const { service } = makeService({ rows });
    const result = await service.getForVehicle(VEHICLE_ID, { limit: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(2);
      expect(result.value.has_more).toBe(true);
      expect(result.value.next_cursor).toBeTruthy();
    }
  });

  it("returns an empty page with no cursor when there are no issues", async () => {
    const { service } = makeService({ rows: [] });
    const result = await service.getForVehicle(VEHICLE_ID, { limit: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(0);
      expect(result.value.has_more).toBe(false);
      expect(result.value.next_cursor).toBeNull();
    }
  });
});

describe("VehicleIssueService.getOne", () => {
  it("returns NOT_FOUND for an unknown id", async () => {
    const { service } = makeService({ one: null });
    const result = await service.getOne("vi-missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("returns the row when it exists", async () => {
    const row = listRow("vi-1", "2026-02-01T06:00:00.000Z");
    const { service } = makeService({ one: row });
    const result = await service.getOne("vi-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("vi-1");
  });
});
