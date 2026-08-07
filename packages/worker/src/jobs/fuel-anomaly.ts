// packages/worker/src/jobs/fuel-anomaly.ts
// `fuel-anomaly` job (05 §2 #9, §3). Scores unprocessed fuel_purchases against the seven rules.
// The rules are pure functions (unit-tested); the job assembles the anomaly rows and persists
// them. Scoring is asynchronous by design — the sync refuel endpoint returns open_anomalies:[].

export type FuelAnomalyType =
  | "POSSIBLE_THEFT_OR_LEAK"
  | "CARD_MISMATCH"
  | "EXPIRED_CARD"
  | "EFFICIENCY_DEVIATION"
  | "PRICE_OUTLIER"
  | "DUPLICATE_PURCHASE"
  | "ODOMETER_ROLLBACK"
  | "ODOMETER_DIVERGENCE"
  | "MISSING_GAUGE_EVIDENCE";

export interface FuelPurchaseFacts {
  id: string;
  vehicleId: string;
  litres: number;
  purchasedAt: Date;
  odometerKm: number;
  cardIsPooled: boolean;
  cardAssignedVehicleId: string | null;
  /** Per-vehicle tank capacity needed for the gauge-rise expectation. */
  tankCapacityL: number;
  beforeGaugePct: number | null;
  afterGaugePct: number | null;
  baselineLper100: number | null;
  actualLper100: number | null;
  unitPrice: number;
  price30dMean: number | null;
  cardExpiresOn: Date | null;
}

export interface DetectedAnomaly {
  type: FuelAnomalyType;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  expectedValue: number | null;
  actualValue: number | null;
  deviationPercent: number | null;
  thresholdPercent: number | null;
}

// --- Pure rules (unit-tested) -------------------------------------------------

/** Expected gauge rise from litres into a known tank, vs the observed before→after delta. */
export function gaugeDeviationPct(beforePct: number, afterPct: number, litres: number, tankCapacityL: number): number {
  if (tankCapacityL <= 0) return 0;
  const expectedRise = (litres / tankCapacityL) * 100;
  return afterPct - beforePct - expectedRise;
}

export function detectTheftOrLeak(f: FuelPurchaseFacts, thresholdPct: number): DetectedAnomaly | null {
  if (f.beforeGaugePct == null || f.afterGaugePct == null) return null;
  const dev = gaugeDeviationPct(f.beforeGaugePct, f.afterGaugePct, f.litres, f.tankCapacityL);
  if (Math.abs(dev) <= thresholdPct) return null;
  return { type: "POSSIBLE_THEFT_OR_LEAK", severity: "HIGH", expectedValue: f.beforeGaugePct + (f.litres / f.tankCapacityL) * 100, actualValue: f.afterGaugePct, deviationPercent: dev, thresholdPercent: thresholdPct };
}

export function detectCardMismatch(f: FuelPurchaseFacts): DetectedAnomaly | null {
  if (f.cardIsPooled) return null; // pooled cards never raise it (M2)
  if (f.cardAssignedVehicleId != null && f.cardAssignedVehicleId !== f.vehicleId) {
    return { type: "CARD_MISMATCH", severity: "MEDIUM", expectedValue: null, actualValue: null, deviationPercent: null, thresholdPercent: null };
  }
  return null;
}

export function detectExpiredCard(f: FuelPurchaseFacts): DetectedAnomaly | null {
  if (f.cardExpiresOn != null && f.cardExpiresOn < f.purchasedAt) {
    return { type: "EXPIRED_CARD", severity: "LOW", expectedValue: null, actualValue: null, deviationPercent: null, thresholdPercent: null };
  }
  return null;
}

export function detectEfficiencyDeviation(f: FuelPurchaseFacts, thresholdPct: number): DetectedAnomaly | null {
  if (f.baselineLper100 == null || f.actualLper100 == null) return null;
  const dev = ((f.actualLper100 - f.baselineLper100) / f.baselineLper100) * 100;
  if (Math.abs(dev) <= thresholdPct) return null;
  return { type: "EFFICIENCY_DEVIATION", severity: "MEDIUM", expectedValue: f.baselineLper100, actualValue: f.actualLper100, deviationPercent: dev, thresholdPercent: thresholdPct };
}

export function detectPriceOutlier(f: FuelPurchaseFacts, thresholdPct: number): DetectedAnomaly | null {
  if (f.price30dMean == null || f.price30dMean === 0) return null;
  const dev = ((f.unitPrice - f.price30dMean) / f.price30dMean) * 100;
  if (Math.abs(dev) <= thresholdPct) return null;
  return { type: "PRICE_OUTLIER", severity: "LOW", expectedValue: f.price30dMean, actualValue: f.unitPrice, deviationPercent: dev, thresholdPercent: thresholdPct };
}

export function detectMissingGaugeEvidence(f: FuelPurchaseFacts): DetectedAnomaly | null {
  if (f.beforeGaugePct == null || f.afterGaugePct == null) {
    return { type: "MISSING_GAUGE_EVIDENCE", severity: "INFO", expectedValue: null, actualValue: null, deviationPercent: null, thresholdPercent: null };
  }
  return null;
}

/** Apply every rule; returns the anomalies to persist. */
export function scorePurchase(f: FuelPurchaseFacts, cfg: { anomalyGaugeDeviationPct: number; efficiencyDeviationPct: number; priceOutlierPct: number }): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  const theft = detectTheftOrLeak(f, cfg.anomalyGaugeDeviationPct);
  if (theft) out.push(theft);
  const mismatch = detectCardMismatch(f);
  if (mismatch) out.push(mismatch);
  const expired = detectExpiredCard(f);
  if (expired) out.push(expired);
  const eff = detectEfficiencyDeviation(f, cfg.efficiencyDeviationPct);
  if (eff) out.push(eff);
  const price = detectPriceOutlier(f, cfg.priceOutlierPct);
  if (price) out.push(price);
  const missing = detectMissingGaugeEvidence(f);
  if (missing) out.push(missing);
  return out;
}

// --- Job ----------------------------------------------------------------------

export interface FuelAnomalyRepository {
  unprocessed(limit: number): Promise<FuelPurchaseFacts[]>;
  insertAnomalies(purchaseId: string, anomalies: DetectedAnomaly[]): Promise<void>;
  markProcessed(purchaseId: string): Promise<void>;
}

export class FuelAnomalyJob {
  constructor(
    private readonly repo: FuelAnomalyRepository,
    private readonly config: { anomalyGaugeDeviationPct: number; efficiencyDeviationPct: number; priceOutlierPct: number },
  ) {}

  async run(limit = 100): Promise<{ scored: number; anomalies: number }> {
    const purchases = await this.repo.unprocessed(limit);
    let anomalies = 0;
    for (const p of purchases) {
      const detected = scorePurchase(p, this.config);
      if (detected.length) {
        await this.repo.insertAnomalies(p.id, detected);
        anomalies += detected.length;
      }
      await this.repo.markProcessed(p.id);
    }
    return { scored: purchases.length, anomalies };
  }
}
