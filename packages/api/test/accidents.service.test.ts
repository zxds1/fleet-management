// packages/api/test/accidents.service.test.ts
// Unit tests for AccidentService / AccidentQuery using fakes (no DB). Covers the B17 mayday escape
// hatch (immediate escalation outbox + durable timer), the PENDING create, media attach (append-only
// + one-per-report primary slot), acknowledge (timer cancellation), and the telemetry hash-chain verify.

import { ok, type Result, type Tx, type DbClient, type ConfigClient } from "@fleet/shared";
import { NotFound } from "@fleet/shared";
import { AccidentService, AccidentQuery } from "../src/services/accidents";
import type { AccidentReportRow, AccidentMediaRow } from "@fleet/shared";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

function makeService(overrides: {
  getReport?: AccidentReportRow | null;
  primaryMediaExists?: boolean;
  configAckMinutes?: number;
} = {}) {
  const insertedReport = {
    id: "acc-1",
    driver_id: "driver-1",
    is_mayday: false,
    status: "PENDING",
    was_off_shift: false,
    telemetry_available: false,
  } as unknown as AccidentReportRow;

  const reports = {
    getById: async (_id: string) => (overrides.getReport !== undefined ? overrides.getReport : insertedReport),
    insertReport: async () => insertedReport,
    update: async () => insertedReport,
  } as unknown as import("../src/repositories/accidents").AccidentReportRepository;

  const media = {
    getById: async () => null,
    insert: async () => ({ id: "m-1" }) as unknown as AccidentMediaRow,
    existsForSlot: async () => overrides.primaryMediaExists ?? false,
  } as unknown as import("../src/repositories/accidents").AccidentMediaRepository;

  const timers = {
    insertTimer: async () => undefined,
    cancelOpen: async () => undefined,
  } as unknown as import("../src/repositories/accidents").EscalationTimerRepository;

  const config = {
    numeric: async (_k: string, d?: number) => overrides.configAckMinutes ?? d ?? 5,
    string: async () => null,
    boolean: async () => false,
  } as unknown as ConfigClient;

  return { svc: new AccidentService(reports, media, timers, config), reports, media, timers, insertedReport };
}

const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };
const maydayInput = {
  shift_id: "shift-1",
  vehicle_id: "veh-1",
  position: { latitude: -1.29, longitude: 36.82 },
  mayday_reason: "Collision on highway",
};

describe("AccidentService.mayday", () => {
  it("records a mayday, stages an escalation timer and fires accident.escalate", async () => {
    const { svc, timers } = makeService();
    const outbox: unknown[] = [];
    const tx2 = { ...tx, registerOutbox: (e: unknown) => void outbox.push(e) } as unknown as Tx;
    const timersCalled: unknown[] = [];
    (timers as unknown as { insertTimer: (...a: unknown[]) => void }).insertTimer = (...a: unknown[]) => void timersCalled.push(a);

    const r: Result<{ accidentId: string; escalatedAt?: string }> = await svc.mayday(tx2, "driver-1", maydayInput, actor);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.accidentId).toBe("acc-1");
      expect(r.value.escalatedAt).toBeDefined();
    }
    expect(timersCalled).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    if (outbox.length) {
      expect((outbox[0] as { event_type: string }).event_type).toBe("accident.escalate");
    }
  });
});

describe("AccidentService.create", () => {
  it("opens a PENDING report and stages an escalation timer", async () => {
    const { svc, timers } = makeService();
    const timersCalled: unknown[] = [];
    (timers as unknown as { insertTimer: (...a: unknown[]) => void }).insertTimer = (...a: unknown[]) => void timersCalled.push(a);
    const input = { shift_id: "shift-1", driver_statement: "Rear-ended at junction" };
    const r = await svc.create(tx, "driver-1", input, actor);
    expect(r.ok).toBe(true);
    expect(timersCalled).toHaveLength(1);
  });

  it("marks was_off_shift when shift_id is null", async () => {
    const { svc, reports } = makeService();
    let captured: unknown;
    (reports as unknown as { insertReport: (r: unknown) => Promise<unknown> }).insertReport = async (r: unknown) => {
      captured = r;
      return {} as AccidentReportRow;
    };
    await svc.create(tx, "driver-1", { shift_id: null }, actor);
    expect((captured as { wasOffShift: boolean }).wasOffShift).toBe(true);
  });
});

describe("AccidentService.attachMedia", () => {
  it("returns NOT_FOUND for an unknown report", async () => {
    const { svc } = makeService({ getReport: null });
    const r = await svc.attachMedia(tx, "missing", { slot: "FRONT_DAMAGE", media_object_id: "mo-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("rejects a duplicate primary slot with DUPLICATE", async () => {
    const { svc } = makeService({ primaryMediaExists: true });
    const r = await svc.attachMedia(tx, "acc-1", { slot: "FRONT_DAMAGE", media_object_id: "mo-1" }, actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error_code).toBe("DUPLICATE");
  });

  it("attaches media for a valid report", async () => {
    const { svc } = makeService();
    const r = await svc.attachMedia(tx, "acc-1", { slot: "ADDITIONAL", media_object_id: "mo-1" }, actor);
    expect(r.ok).toBe(true);
  });
});

describe("AccidentService.acknowledge", () => {
  it("returns NOT_FOUND for an unknown report", async () => {
    const { svc } = makeService({ getReport: null });
    const r = await svc.acknowledge(tx, "missing", actor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("cancels open escalation timers", async () => {
    const { svc, timers } = makeService();
    const cancelled: unknown[] = [];
    (timers as unknown as { cancelOpen: (...a: unknown[]) => void }).cancelOpen = (...a: unknown[]) => void cancelled.push(a);
    const r = await svc.acknowledge(tx, "acc-1", actor);
    expect(r.ok).toBe(true);
    expect(cancelled).toHaveLength(1);
  });
});

describe("AccidentQuery.verifyChain", () => {
  it("returns per-row validity from the hash chain", async () => {
    const client = {
      query: async () => ({
        rows: [
          { sequence: 1, is_valid: true, expected_hash: Buffer.from("aa"), stored_hash: Buffer.from("aa") },
          { sequence: 2, is_valid: false, expected_hash: Buffer.from("bb"), stored_hash: Buffer.from("cc") },
        ],
      }),
    } as unknown as DbClient;
    const q = new AccidentQuery(client);
    const r: Result<{ all_valid: boolean; rows: { sequence: number; is_valid: boolean }[] }> = await q.verifyChain("acc-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.all_valid).toBe(false);
      expect(r.value.rows).toHaveLength(2);
    }
  });
});

void ok;
