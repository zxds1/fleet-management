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
