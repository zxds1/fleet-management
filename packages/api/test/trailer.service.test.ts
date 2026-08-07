// packages/api/test/trailer.service.test.ts
// Unit tests for TrailerService.swap using fakes (no DB). Covers: hook of an existing trailer,
// drop-to-bobtail (closes active assignment), driver-created external trailer (C1.11, is_external),
// the TRAILER_SWAP inspection requirement, the double-hook guard (DUPLICATE), and the drop-photo
// requirement.

import { ok, type Result, type Tx, type DbClient } from "@fleet/shared";
import { NotFound, ValidationError } from "@fleet/shared";
import { TrailerService } from "../src/services/trailer";
import type {
  InspectionRow,
  TrailerAssignmentRow,
  TrailerRow,
} from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

const swapTmplInspection = { id: "insp-swap", subject: "TRAILER_SWAP" } as unknown as InspectionRow;

function makeService(overrides: {
  activeByVehicle?: TrailerAssignmentRow | null;
  activeByTrailer?: TrailerAssignmentRow | null;
  inspection?: InspectionRow | null;
} = {}) {
  const inspections = {
    getById: async (_id: string) => (overrides.inspection !== undefined ? overrides.inspection : swapTmplInspection),
  } as unknown as import("../src/repositories/inspections").InspectionRepository;

  const trailers = {
    getById: async (id: string) => ({ id, license_plate: "KAA123", trailer_type: "DRY_VAN", is_external: false } as unknown as TrailerRow),
    insert: async (r: unknown) => ({ id: "trailer-new", ...(r as object) }) as unknown as TrailerRow,
    update: async () => ({} as TrailerRow),
  } as unknown as import("../src/repositories/shifts").TrailerRepository;

  const assignments = {
    findActiveByVehicle: async () => overrides.activeByVehicle ?? null,
    findActiveByTrailer: async () => overrides.activeByTrailer ?? null,
    insert: async (r: unknown) => ({ id: "ta-1", ...(r as object) }) as unknown as TrailerAssignmentRow,
    update: async () => ({} as TrailerAssignmentRow),
  } as unknown as import("../src/repositories/trailer").TrailerAssignmentRepository;

  return { svc: new TrailerService(assignments, trailers, inspections), assignments, trailers };
}

const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };
const base = {
  vehicle_id: "veh-1",
  hook_media_object_id: "mo-hook",
  hook_inspection_id: "insp-swap",
};

describe("TrailerService.swap", () => {
  it("hooks an existing trailer when none is active", async () => {
    const { svc } = makeService();
    const r: Result<{ trailerAssignmentId: string | null }> = await svc.swap(tx, "driver-1", {
      ...base,
      trailer_id: "trailer-1",
      drop_media_object_id: undefined,
    }, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.trailerAssignmentId).toBe("ta-1");
  });

  it("requires the hook inspection to be a TRAILER_SWAP check", async () => {
    const { svc } = makeService({ inspection: { id: "x", subject: "VEHICLE" } as unknown as InspectionRow });
    const r = await svc.swap(tx, "driver-1", { ...base, trailer_id: "trailer-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ValidationError);
  });

  it("returns NOT_FOUND for a missing hook inspection", async () => {
    const { svc } = makeService({ inspection: null });
    const r = await svc.swap(tx, "driver-1", { ...base, trailer_id: "trailer-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("closes the active assignment when dropping to bobtail", async () => {
    const { svc, assignments } = makeService({
      activeByVehicle: { id: "ta-old", trailer_id: "trailer-old", vehicle_id: "veh-1" } as unknown as TrailerAssignmentRow,
    });
    const updates: unknown[] = [];
    (assignments as unknown as { update: (...a: unknown[]) => void }).update = (...a: unknown[]) => void updates.push(a);
    const r = await svc.swap(tx, "driver-1", { ...base, trailer_id: null, drop_media_object_id: "mo-drop" }, actor);
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1); // closes the old assignment
  });

  it("requires drop_media_object_id when an assignment is active", async () => {
    const { svc } = makeService({
      activeByVehicle: { id: "ta-old", trailer_id: "trailer-old", vehicle_id: "veh-1" } as unknown as TrailerAssignmentRow,
    });
    const r = await svc.swap(tx, "driver-1", { ...base, trailer_id: "trailer-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ValidationError);
  });

  it("creates an external trailer for a driver-supplied plate (C1.11)", async () => {
    const { svc, trailers } = makeService();
    const inserts: unknown[] = [];
    (trailers as unknown as { insert: (...a: unknown[]) => unknown }).insert = (r: unknown) => {
      inserts.push(r);
      return { id: "trailer-new", ...(r as object) };
    };
    const r: Result<{ createdTrailerId: string | null }> = await svc.swap(tx, "driver-1", {
      ...base,
      new_trailer_plate: "KBB987",
      new_trailer_type: "REEFER",
    }, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.createdTrailerId).toBe("trailer-new");
    expect(inserts).toHaveLength(1);
  });

  it("rejects a double-hook onto another vehicle (DUPLICATE)", async () => {
    const { svc } = makeService({
      activeByTrailer: { id: "ta-other", trailer_id: "trailer-1", vehicle_id: "veh-2" } as unknown as TrailerAssignmentRow,
    });
    const r = await svc.swap(tx, "driver-1", { ...base, trailer_id: "trailer-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("DUPLICATE");
  });
});

void ok;
