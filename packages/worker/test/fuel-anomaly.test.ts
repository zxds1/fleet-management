// packages/worker/test/fuel-anomaly.test.ts
import {
  gaugeDeviationPct,
  detectTheftOrLeak,
  detectCardMismatch,
  detectExpiredCard,
  detectEfficiencyDeviation,
  detectPriceOutlier,
  scorePurchase,
} from "../src/jobs/fuel-anomaly";

describe("fuel-anomaly pure rules (05 §3)", () => {
  it("computes expected gauge rise from litres / tank", () => {
    // 40 L into a 200 L tank = +20%. Going 10%->40% is +30%, expected +20% => deviation +10.
    expect(gaugeDeviationPct(10, 40, 40, 200)).toBeCloseTo(10);
  });

  it("flags POSSIBLE_THEFT_OR_LEAK beyond threshold", () => {
    const f = { beforeGaugePct: 10, afterGaugePct: 40, litres: 40, tankCapacityL: 200 } as any;
    const a = detectTheftOrLeak(f, 20);
    expect(a).toBeNull(); // deviation +10 <= 20
    const a2 = detectTheftOrLeak({ ...f }, 5);
    expect(a2?.type).toBe("POSSIBLE_THEFT_OR_LEAK");
  });

  it("does not flag CARD_MISMATCH for pooled cards", () => {
    expect(detectCardMismatch({ cardIsPooled: true, cardAssignedVehicleId: "x", vehicleId: "y" } as any)).toBeNull();
  });

  it("flags CARD_MISMATCH for dedicated card on wrong vehicle", () => {
    const a = detectCardMismatch({ cardIsPooled: false, cardAssignedVehicleId: "x", vehicleId: "y" } as any);
    expect(a?.type).toBe("CARD_MISMATCH");
  });

  it("flags EXPIRED_CARD", () => {
    const a = detectExpiredCard({ cardExpiresOn: new Date("2026-01-01"), purchasedAt: new Date("2026-02-01") } as any);
    expect(a?.type).toBe("EXPIRED_CARD");
  });

  it("flags EFFICIENCY_DEVIATION beyond threshold", () => {
    const a = detectEfficiencyDeviation({ baselineLper100: 30, actualLper100: 40 } as any, 20);
    expect(a?.type).toBe("EFFICIENCY_DEVIATION"); // +33% > 20
  });

  it("flags PRICE_OUTLIER", () => {
    const a = detectPriceOutlier({ unitPrice: 200, price30dMean: 100 } as any, 20);
    expect(a?.type).toBe("PRICE_OUTLIER"); // +100% > 20
  });

  it("scorePurchase assembles all anomalies", () => {
    const f = {
      vehicleId: "v",
      litres: 40,
      beforeGaugePct: 10,
      afterGaugePct: 40,
      tankCapacityL: 200,
      cardIsPooled: false,
      cardAssignedVehicleId: "other",
      baselineLper100: 30,
      actualLper100: 45,
      unitPrice: 200,
      price30dMean: 100,
    } as any;
    const anomalies = scorePurchase(f, { anomalyGaugeDeviationPct: 5, efficiencyDeviationPct: 20, priceOutlierPct: 20 });
    const types = anomalies.map((a) => a.type);
    expect(types).toContain("CARD_MISMATCH");
    expect(types).toContain("EFFICIENCY_DEVIATION");
    expect(types).toContain("PRICE_OUTLIER");
    expect(types).toContain("POSSIBLE_THEFT_OR_LEAK");
  });
});
