// packages/api/test/inspections.service.test.ts
// Unit tests for InspectionService.submit using fakes (no DB). Covers the DVIR invariants: previous
// defects must be reviewed (DEFECTS_NOT_REVIEWED), a FAIL item requires a note + photo
// (DVIR_FAIL_NEEDS_PHOTO), BLOCKER failures quarantine the asset + mark it non-operational (C1.5), and
// a clean pass returns blockShift=false.

import { ok, type Result, type Tx, type DbClient } from "@fleet/shared";
import { NotFound, ValidationError } from "@fleet/shared";
import { InspectionService } from "../src/services/inspections";
import type {
  InspectionRow,
  InspectionTemplateItemRow,
  InspectionTemplateRow,
  QuarantineEventRow,
  VehicleRow,
} from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

const blockerTmpl = {
  id: "ti-1",
  template_id: "tpl-1",
  code: "BRAKES",
  label_en: "Brakes",
  label_sw: "Bremu",
  severity: "BLOCKER",
  input_type: "PASS_FAIL",
  unit: null,
  min_value: null,
  max_value: null,
  is_required: true,
  sequence: 1,
} as unknown as InspectionTemplateItemRow;

const warningTmpl = { ...blockerTmpl, id: "ti-2", code: "LIGHTS", label_en: "Lights", severity: "WARNING" } as unknown as InspectionTemplateItemRow;

function makeService(overrides: {
  template?: InspectionTemplateRow | null;
  templateItems?: Record<string, InspectionTemplateItemRow>;
  openQuarantine?: boolean;
} = {}) {
  const insertedInspection = { id: "insp-1" } as unknown as InspectionRow;
  const inspections = {
    insert: async () => insertedInspection,
  } as unknown as import("../src/repositories/inspections").InspectionRepository;

  const items = {
    insert: async (r: unknown) => ({ id: "ii-1", ...(r as object) }),
  } as unknown as import("../src/repositories/inspections").InspectionItemRepository;

  const photos = {
    insert: async () => ({ id: "p-1" }),
  } as unknown as import("../src/repositories/inspections").InspectionItemPhotoRepository;

  const templates = {
    getById: async (_id: string) => (overrides.template !== undefined ? overrides.template : ({ id: "tpl-1", subject: "VEHICLE", version: 1 } as unknown as InspectionTemplateRow)),
  } as unknown as import("../src/repositories/inspections").InspectionTemplateRepository;

  const templateItems = {
    getById: async (id: string) => overrides.templateItems?.[id] ?? blockerTmpl,
  } as unknown as import("../src/repositories/inspections").InspectionTemplateItemRepository;

  const vehicleUpdates: unknown[] = [];
  const vehicles = {
    update: async (id: string, patch: unknown) => void vehicleUpdates.push({ id, patch }),
  } as unknown as import("../src/repositories/shifts").VehicleRepository;

  const trailers = {
    update: async () => undefined,
  } as unknown as import("../src/repositories/shifts").TrailerRepository;

  const quarantineRows: QuarantineEventRow[] = [];
  const quarantine = {
    hasOpenForAsset: async () => overrides.openQuarantine ?? false,
    insert: async (r: unknown) => void quarantineRows.push(r as QuarantineEventRow),
  } as unknown as import("../src/repositories/inspections").QuarantineRepository;

  return { svc: new InspectionService(inspections, items, photos, templates, templateItems, vehicles, trailers, quarantine), vehicleUpdates, quarantineRows, insertedInspection };
}

const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };
const baseInput = {
  shift_id: "shift-1",
  template_id: "tpl-1",
  subject: "VEHICLE" as const,
  vehicle_id: "veh-1",
  previous_defects_reviewed: true,
  signature_name: "J. Driver",
  items: [],
};

describe("InspectionService.submit", () => {
  it("returns NOT_FOUND for an unknown template", async () => {
    const { svc } = makeService({ template: null });
    const r = await svc.submit(tx, "driver-1", { ...baseInput, items: [] }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("rejects when previous_defects_reviewed is false (DEFECTS_NOT_REVIEWED)", async () => {
    const { svc } = makeService();
    const r = await svc.submit(tx, "driver-1", { ...baseInput, previous_defects_reviewed: false, items: [] }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("DEFECTS_NOT_REVIEWED");
  });

  it("requires a photo for a FAIL item (DVIR_FAIL_NEEDS_PHOTO)", async () => {
    const { svc } = makeService({ templateItems: { "ti-1": blockerTmpl } });
    const r = await svc.submit(tx, "driver-1", {
      ...baseInput,
      items: [{ template_item_id: "ti-1", result: "FAIL", notes: "Cracked", photo_media_object_id: undefined }],
    }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("DVIR_FAIL_NEEDS_PHOTO");
  });

  it("requires a note for a FAIL item", async () => {
    const { svc } = makeService({ templateItems: { "ti-1": blockerTmpl } });
    const r = await svc.submit(tx, "driver-1", {
      ...baseInput,
      items: [{ template_item_id: "ti-1", result: "FAIL", notes: "", photo_media_object_id: "mo-1" }],
    }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ValidationError);
  });

  it("quarantines a vehicle on a BLOCKER failure and reports blockShift", async () => {
    const { svc, vehicleUpdates, quarantineRows } = makeService({ templateItems: { "ti-1": blockerTmpl } });
    const r: Result<{ inspectionId: string; blockShift: boolean }> = await svc.submit(tx, "driver-1", {
      ...baseInput,
      items: [{ template_item_id: "ti-1", result: "FAIL", notes: "Brake failure", photo_media_object_id: "mo-1" }],
    }, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.blockShift).toBe(true);
    expect(vehicleUpdates).toHaveLength(1);
    expect((vehicleUpdates[0] as { patch: Partial<VehicleRow> }).patch.is_operational).toBe(false);
    expect(quarantineRows).toHaveLength(1);
    expect((quarantineRows[0] as QuarantineEventRow).reason).toBe("FAILED_INSPECTION");
  });

  it("does not double-quarantine when one is already open", async () => {
    const { svc, quarantineRows } = makeService({ templateItems: { "ti-1": blockerTmpl }, openQuarantine: true });
    const r = await svc.submit(tx, "driver-1", {
      ...baseInput,
      items: [{ template_item_id: "ti-1", result: "FAIL", notes: "Brake failure", photo_media_object_id: "mo-1" }],
    }, actor);
    expect(r.ok).toBe(true);
    expect(quarantineRows).toHaveLength(0);
  });

  it("accepts a clean pass without quarantine", async () => {
    const { svc, quarantineRows, vehicleUpdates } = makeService({ templateItems: { "ti-1": blockerTmpl, "ti-2": warningTmpl } });
    const r: Result<{ inspectionId: string; blockShift: boolean }> = await svc.submit(tx, "driver-1", {
      ...baseInput,
      items: [
        { template_item_id: "ti-1", result: "PASS" },
        { template_item_id: "ti-2", result: "PASS" },
      ],
    }, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.blockShift).toBe(false);
    expect(quarantineRows).toHaveLength(0);
    expect(vehicleUpdates).toHaveLength(0);
  });
});

void ok;
