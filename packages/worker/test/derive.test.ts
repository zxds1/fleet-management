// packages/worker/test/derive.test.ts
import { computeTrackerHealth, OffShiftMovementDetector } from "../src/ingest/derive";

const cfg = { offlineThresholdMinutes: 15, speedLimitKph: 80, movingSpeedKph: 3, now: new Date("2026-01-01T12:00:00Z") };

describe("computeTrackerHealth", () => {
  it("marks OFFLINE when the position is stale", () => {
    const pos = { vehicleId: "v1", recordedAt: new Date("2026-01-01T11:00:00Z"), speedKph: 0, ignition: false } as any;
    const h = computeTrackerHealth(null, pos, cfg);
    expect(h.isOnline).toBe(false);
    expect(h.displayState).toBe("OFFLINE");
    expect(h.offlineSince).not.toBeNull();
  });

  it("marks SPEEDING above the limit", () => {
    const pos = { vehicleId: "v1", recordedAt: new Date("2026-01-01T12:00:00Z"), speedKph: 95, ignition: true } as any;
    const h = computeTrackerHealth(null, pos, cfg);
    expect(h.isOnline).toBe(true);
    expect(h.displayState).toBe("SPEEDING");
  });

  it("marks PARKED when online, stationary and ignition off", () => {
    const pos = { vehicleId: "v1", recordedAt: new Date("2026-01-01T12:00:00Z"), speedKph: 0, ignition: false } as any;
    const h = computeTrackerHealth(null, pos, cfg);
    expect(h.displayState).toBe("PARKED");
  });
});

describe("OffShiftMovementDetector (C5.6)", () => {
  it("emits START then END with duration, storing no coordinates", () => {
    const d = new OffShiftMovementDetector(3);
    const start = { vehicleId: "v1", recordedAt: new Date("2026-01-01T03:00:00Z"), speedKph: 20, ignition: true } as any;
    const mid = { vehicleId: "v1", recordedAt: new Date("2026-01-01T03:05:00Z"), speedKph: 0, ignition: false } as any;
    const end = { vehicleId: "v1", recordedAt: new Date("2026-01-01T03:10:00Z"), speedKph: 0, ignition: false } as any;

    const e1 = d.observe("v1", start);
    const e2 = d.observe("v1", mid); // still moving? speed 0 -> ends
    expect(e1[0]!.kind).toBe("OFF_SHIFT_MOVEMENT_START");
    expect(e2[0]!.kind).toBe("OFF_SHIFT_MOVEMENT_END");
    expect(e2[0]!.durationSeconds).toBe(300);
    expect(e2[0]!).not.toHaveProperty("latitude");

    const e3 = d.observe("v1", end);
    expect(e3).toHaveLength(0); // already closed
  });
});
