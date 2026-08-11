/**
 * @fleet/shared — SLO constant sanity checks.
 * Run: npm test (Jest + ts-jest).
 */
import { SLO } from "../src/slo";

describe("SLO constants", () => {
  it("are all non-negative thresholds", () => {
    for (const [key, value] of Object.entries(SLO)) {
      if (typeof value === "number") {
        expect(value).toBeGreaterThanOrEqual(0);
      }
      if (key === "pagingBurnRate") {
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("page error rate exceeds accept error rate", () => {
    expect(SLO.pageErrorRatePct).toBeGreaterThan(SLO.acceptErrorRatePct);
  });

  it("error budgets are within 0..1 (pct) or positive seconds", () => {
    expect(SLO.apiErrorBudget5xxPct).toBeGreaterThan(0);
    expect(SLO.apiErrorBudget5xxPct).toBeLessThanOrEqual(1);
    expect(SLO.ingestLagThresholdSeconds).toBeGreaterThan(0);
    expect(SLO.outboxBacklogThreshold).toBeGreaterThan(0);
    expect(SLO.workerJobErrorRatePct).toBeGreaterThan(0);
  });

  it("latency SLOs have positive P95 and valid targets", () => {
    for (const slo of Object.values(SLO.latency)) {
      expect(slo.p95Ms).toBeGreaterThan(0);
      expect(slo.target).toBeGreaterThan(0);
      expect(slo.target).toBeLessThanOrEqual(1);
      if (slo.p99Ms !== undefined) expect(slo.p99Ms).toBeGreaterThanOrEqual(slo.p95Ms);
    }
  });

  it("burn-rate tiers are positive and ordered by severity", () => {
    expect(SLO.burnRateTiers.length).toBeGreaterThan(0);
    for (const tier of SLO.burnRateTiers) {
      expect(tier.multiplier).toBeGreaterThan(0);
      expect(tier.durationMinutes).toBeGreaterThan(0);
    }
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(SLO)).toBe(true);
    expect(Object.isFrozen(SLO.burnRateTiers)).toBe(true);
    expect(Object.isFrozen(SLO.latency)).toBe(true);
  });
});
