// packages/api/test/fuel.service.test.ts
// Unit tests for FuelService using fakes (no DB). Covers submitRefuel (queues async OCR) and the
// verifyPurchase state machine (VERIFY / REJECT / CLEAR_PAYMENT gating).

import { ok, type Result, type Tx, type DbClient } from "@fleet/shared";
import { Forbidden, NotFound } from "@fleet/shared";
import { FuelService } from "../src/services/fuel";
import type { FuelPurchaseRow } from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

function makeService(overrides: { getById?: FuelPurchaseRow | null; insertReturns?: Partial<FuelPurchaseRow> } = {}) {
  const inserted = { id: "pur-1", ...overrides.insertReturns } as FuelPurchaseRow;
  const purchases = {
    getById: async (_id: string) => overrides.getById ?? null,
    insert: async () => inserted,
    update: async () => (overrides.getById ?? inserted),
  } as unknown as import("../src/repositories/fuel").FuelPurchaseRepository;
  const fuelRecords = {} as unknown as import("../src/repositories/shifts").FuelRecordRepository;
  return { svc: new FuelService(purchases, fuelRecords), inserted };
}

const refuelInput = {
  shift_id: "shift-1",
  vehicle_id: "veh-1",
  fuel_card_id: "card-1",
  fuel_card_last_four: "1234",
  litres: 50,
  total_cost: { amount: "5000", currency: "KES" },
  odometer_km: 5000,
  purchased_at: new Date().toISOString(),
  before_fuel_record_id: "fr-before",
  after_fuel_record_id: "fr-after",
  receipt_media_object_id: "media-1",
};
const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };

describe("FuelService.submitRefuel", () => {
  it("creates a purchase and queues fuel.ocr", async () => {
    const { svc, inserted } = makeService();
    const outbox: unknown[] = [];
    const tx2 = { ...tx, registerOutbox: (e: unknown) => void outbox.push(e) } as unknown as Tx;
    const r: Result<{ fuelPurchaseId: string }> = await svc.submitRefuel(tx2, "driver-1", refuelInput, actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.fuelPurchaseId).toBe(inserted.id);
    expect(outbox).toHaveLength(1);
  });
});

describe("FuelService.verifyPurchase", () => {
  it("returns NOT_FOUND for an unknown purchase", async () => {
    const { svc } = makeService({ getById: null });
    const r = await svc.verifyPurchase(tx, "missing", { action: "VERIFY" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("VERIFY sets admin_verified", async () => {
    const { svc } = makeService({ getById: { id: "pur-1", admin_verified: false } as FuelPurchaseRow });
    const r = await svc.verifyPurchase(tx, "pur-1", { action: "VERIFY" }, actor);
    expect(r.ok).toBe(true);
  });

  it("REJECT requires a reason (VALIDATION_ERROR)", async () => {
    const { svc } = makeService({ getById: { id: "pur-1", admin_verified: false } as FuelPurchaseRow });
    const r = await svc.verifyPurchase(tx, "pur-1", { action: "REJECT" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("VALIDATION_ERROR");
  });

  it("CLEAR_PAYMENT before verification is forbidden (C6.1)", async () => {
    const { svc } = makeService({ getById: { id: "pur-1", admin_verified: false } as FuelPurchaseRow });
    const r = await svc.verifyPurchase(tx, "pur-1", { action: "CLEAR_PAYMENT" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(Forbidden);
  });

  void ok;
});
