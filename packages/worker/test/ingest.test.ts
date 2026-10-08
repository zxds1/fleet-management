// packages/worker/test/ingest.test.ts
// End-to-end of the ingest pipeline against a fake DbClient: off-shift positions are discarded
// (only a movement ledger entry) and on-shift positions are retained (location_updates insert).
import { IngestConsumer } from "../src/ingest/consumer";
import { parseTraccarPosition } from "../src/ingest/traccar";
import type { RetentionContextData } from "../src/ingest/repository";
import type { PoolLike } from "@fleet/shared";

const allQueries: string[] = [];

class FakeClient {
  async query(text: string) {
    allQueries.push(text);
    return { rows: [], rowCount: 0 };
  }
  release() {}
}

class FakePool implements PoolLike {
  connect() {
    return Promise.resolve(new FakeClient() as any);
  }
}

class TestConsumer extends IngestConsumer {
  constructor() {
    super({ pool: new FakePool() as any, config: { numeric: async () => 15 } as any, redis: null });
  }
  protected async contextFor(): Promise<RetentionContextData> {
    return {
      shiftWindow: { start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T18:00:00Z") },
      recoveryModeActive: false,
      openAccident: false,
      tenantId: "00000000-0000-0000-0000-000000000001",
    };
  }
  protected async shiftIdFor() {
    return null;
  }
}

describe("IngestConsumer.processPositions (04 §3)", () => {
  beforeEach(() => allQueries.length = 0);

  it("retains on-shift and discards off-shift positions", async () => {
    const c = new TestConsumer();
    const onShift = parseTraccarPosition({ id: 1, deviceId: 5, vehicleId: "v1", fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8, speed: 10, attributes: {} });
    const offShift = parseTraccarPosition({ id: 2, deviceId: 5, vehicleId: "v1", fixTime: "2026-01-01T03:00:00Z", latitude: -1.2, longitude: 36.8, speed: 30, attributes: {} });

    const res = await c.processPositions([offShift, onShift]);

    expect(res.retained).toBe(1);
    expect(res.discarded).toBe(1);
    expect(allQueries.some((q) => q.includes("INSERT INTO telemetry.location_updates"))).toBe(true);
    expect(allQueries.some((q) => q.includes("INSERT INTO app.vehicle_movement_events"))).toBe(true);
  });

  it("forces retention under an open accident even off-shift", async () => {
    class AccidentConsumer extends TestConsumer {
  protected async contextFor(): Promise<RetentionContextData> {
        return { shiftWindow: null, recoveryModeActive: false, openAccident: true, tenantId: "00000000-0000-0000-0000-000000000001" };
      }
    }
    const c = new AccidentConsumer();
    const offShift = parseTraccarPosition({ id: 3, deviceId: 5, vehicleId: "v1", fixTime: "2026-01-01T03:00:00Z", latitude: -1.2, longitude: 36.8, speed: 30, attributes: {} });
    const res = await c.processPositions([offShift]);
    expect(res.retained).toBe(1);
    expect(res.discarded).toBe(0);
  });
});

// U-01: a phone-GPS point carries no Traccar identity. `parseTraccarPosition` used to coerce those to
// Number(undefined) = NaN, which telemetry.location_updates.traccar_position_id (bigint) rejects, so
// 100% of phone batches were dead-lettered while the API answered 202.
describe("parseTraccarPosition: a phone point has no Traccar identity", () => {
  it("maps absent / null / non-numeric ids to null, never NaN or 0", () => {
    const base = {
      vehicleId: "v1",
      fixTime: "2026-01-01T12:00:00Z",
      latitude: -1.2,
      longitude: 36.8,
      attributes: {},
    };
    for (const raw of [
      { ...base },                                  // absent
      { ...base, id: null, deviceId: null },        // explicit null (normalizePhonePoint)
      { ...base, id: "", deviceId: "" },            // empty string
      { ...base, id: "not-a-number" },              // garbage
    ]) {
      const pos = parseTraccarPosition(raw);
      expect(pos.traccarPositionId, JSON.stringify(raw.id)).toBeNull();
      expect(pos.traccarDeviceId, JSON.stringify(raw.deviceId)).toBeNull();
      // The insert binds these straight into a bigint column, so neither may be NaN.
      expect(Number.isNaN(pos.traccarPositionId as unknown as number)).toBe(false);
    }
  });

  it("still parses a real Traccar fix's numeric ids", () => {
    const pos = parseTraccarPosition({
      id: 1, deviceId: 5, vehicleId: "v1",
      fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8, attributes: {},
    });
    expect(pos.traccarPositionId).toBe(1);
    expect(pos.traccarDeviceId).toBe(5);
  });

  it("carries is_valid_fix through from the sender's flag, defaulting to true", () => {
    const base = {
      id: 1, deviceId: 5, vehicleId: "v1",
      fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8,
    };
    expect(parseTraccarPosition({ ...base, attributes: {} }).isValidFix).toBe(true);
    expect(parseTraccarPosition({ ...base, attributes: { isValidFix: false } }).isValidFix).toBe(false);
    expect(parseTraccarPosition({ ...base, attributes: { isValidFix: true } }).isValidFix).toBe(true);
  });

  it("a no-fix phone point is retained on the trail without being a driving fix", async () => {
    const c = new TestConsumer();
    const pos = parseTraccarPosition({
      id: null, deviceId: null, vehicleId: "v1",
      fixTime: "2026-01-01T12:00:00Z", latitude: -1.2, longitude: 36.8, speed: 0,
      attributes: { source: "PHONE_GPS", isValidFix: false },
    });
    const res = await c.processPositions([pos]);
    expect(res.retained).toBe(1);
    // is_valid_fix must be a BOUND parameter, never the hardcoded `true` literal.
    expect(allQueries.some((q) => q.includes("INSERT INTO telemetry.location_updates"))).toBe(true);
    expect(allQueries.some((q) => /\$17,true,/.test(q))).toBe(false);
  });
});
