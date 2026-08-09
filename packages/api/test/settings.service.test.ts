// packages/api/test/settings.service.test.ts
// Unit tests for SettingsService using hand-rolled fakes (no DB). Covers the guard rails on the
// admin triggers screen: only allow-listed keys are editable (CONFIG_KEY_NOT_ALLOWED), an undefined
// key is a 404 rather than an insert, the value must match the row's declared value_type
// (CONFIG_VALUE_INVALID) and stay inside min/max (CONFIG_VALUE_OUT_OF_RANGE), and sensitive values
// are redacted on the way out.

import { type DbClient, type Tx } from "@fleet/shared";
import type { SystemConfigRow } from "@fleet/shared";
import { SettingsService, TRIGGER_KEYS, checkBounds, validateValue } from "../src/services/settings";

const outbox: unknown[] = [];
const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: (e: unknown) => void outbox.push(e),
} as unknown as Tx;

const actor = { userId: "usr-1" };

const ackTimeout = {
  key: "accident.ack_timeout_minutes",
  value: 5,
  value_type: "number",
  description: "Acknowledgement window before escalation (C6.3).",
  min_value: "1",
  max_value: "60",
  unit: "minutes",
  is_sensitive: false,
  phase: 3,
  updated_by: null,
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as SystemConfigRow;

function makeService(overrides: { row?: SystemConfigRow | null; rows?: SystemConfigRow[] } = {}) {
  const updates: unknown[] = [];
  const settings = {
    findByKeys: async () => overrides.rows ?? [ackTimeout],
    findByKey: async () => (overrides.row !== undefined ? overrides.row : ackTimeout),
    updateValue: async (key: string, value: string, actorId: string) => {
      updates.push({ key, value, actorId });
      const base = overrides.row !== undefined ? overrides.row : ackTimeout;
      return base ? ({ ...base, value: JSON.parse(value) } as SystemConfigRow) : null;
    },
  } as unknown as import("../src/repositories/settings").SettingsRepository;
  return { service: new SettingsService(settings), updates };
}

describe("SettingsService.listTriggers", () => {
  it("projects the allow-listed rows", async () => {
    const { service } = makeService();
    const result = await service.listTriggers();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data).toHaveLength(1);
    expect(result.value.data[0]).toMatchObject({ key: "accident.ack_timeout_minutes", value: 5, value_type: "number" });
  });

  it("redacts sensitive values", async () => {
    const { service } = makeService({ rows: [{ ...ackTimeout, is_sensitive: true } as SystemConfigRow] });
    const result = await service.listTriggers();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data[0]?.value).toBe("***");
  });
});

describe("SettingsService.updateTrigger", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("rejects a key outside the trigger allow-list", async () => {
    const { service } = makeService();
    const result = await service.updateTrigger(tx, { key: "retention.audit_days", value: 1 }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("CONFIG_KEY_NOT_ALLOWED");
  });

  it("maps an allow-listed but unseeded key to NOT_FOUND", async () => {
    const { service } = makeService({ row: null });
    const result = await service.updateTrigger(tx, { key: "anomaly.speed_threshold_kph", value: 90 }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("rejects a value whose type does not match value_type", async () => {
    const { service } = makeService();
    const result = await service.updateTrigger(tx, { key: "accident.ack_timeout_minutes", value: "soon" }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("CONFIG_VALUE_INVALID");
  });

  it("rejects a value outside the declared min/max bounds", async () => {
    const { service } = makeService();
    const result = await service.updateTrigger(tx, { key: "accident.ack_timeout_minutes", value: 600 }, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("CONFIG_VALUE_OUT_OF_RANGE");
  });

  it("updates a valid value and stages an outbox event", async () => {
    const { service, updates } = makeService();
    const result = await service.updateTrigger(tx, { key: "accident.ack_timeout_minutes", value: 10 }, actor);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe(10);
    // The value must reach the driver as jsonb text so any value_type round-trips.
    expect(updates[0]).toMatchObject({ key: "accident.ack_timeout_minutes", value: "10", actorId: "usr-1" });
    expect(outbox[0]).toMatchObject({ event_type: "config.trigger.updated", aggregate_id: "accident.ack_timeout_minutes" });
  });
});

describe("settings value guards", () => {
  it("validates each supported value_type", () => {
    expect(validateValue("number", 1).ok).toBe(true);
    expect(validateValue("number", Number.NaN).ok).toBe(false);
    expect(validateValue("string", "x").ok).toBe(true);
    expect(validateValue("boolean", true).ok).toBe(true);
    expect(validateValue("array", [1]).ok).toBe(true);
    expect(validateValue("array", {}).ok).toBe(false);
    expect(validateValue("mystery", 1).ok).toBe(false);
  });

  it("only bounds-checks numbers", () => {
    expect(checkBounds("1", "10", 5).ok).toBe(true);
    expect(checkBounds("1", "10", 0).ok).toBe(false);
    expect(checkBounds("1", "10", 11).ok).toBe(false);
    expect(checkBounds("1", "10", "not a number").ok).toBe(true);
    expect(checkBounds(null, null, 999).ok).toBe(true);
  });

  it("exposes a non-empty trigger allow-list", () => {
    expect(TRIGGER_KEYS.length).toBeGreaterThan(0);
  });
});
