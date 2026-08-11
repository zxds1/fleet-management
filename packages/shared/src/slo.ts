// packages/shared/src/slo.ts
// Frozen SLO + error-budget thresholds.
// Derived from docs/backend/slo.md §2–§5 and deploy/monitoring/alerts.yaml.
// These are importable code constants so alerts, dashboards and tests share one
// source of truth instead of prose in docs.

/** Burn-rate tiers (multiplier × duration) from slo.md §1 and §4. */
export interface BurnRateTier {
  /** Burn-rate multiplier (e.g. 14.4 → 144×). */
  multiplier: number;
  /** Alert duration window in minutes. */
  durationMinutes: number;
  /** "page" pages on-call; "warn" goes to the ops channel. */
  action: "page" | "warn";
}

/** Latency SLO threshold (P95/P99) in milliseconds. */
export interface LatencySlo {
  /** SLO id (e.g. "L-01"). */
  id: string;
  /** P95 threshold in ms. */
  p95Ms: number;
  /** P99 threshold in ms, if defined. */
  p99Ms?: number;
  /** SLO target as a fraction in [0,1]. */
  target: number;
  description: string;
}

export const SLO = Object.freeze({
  /** A-01: API 5xx budget — ≤ 0.1 % of requests may 5xx (99.9 % success). */
  apiErrorBudget5xxPct: 0.1,

  /** A-02: API auth routes 401/403/429 budget — ≤ 0.5 %. */
  apiAuthErrorBudgetPct: 0.5,

  /** A-03: Telemetry ingest 5xx budget — ≤ 0.5 %. */
  ingestErrorBudget5xxPct: 0.5,

  /** A-04: Worker job success — ≥ 99 % (i.e. ≤ 1 % error rate). */
  workerJobErrorRatePct: 1,

  /** A-05: DB connectivity target — ≥ 99.95 %. */
  dbConnectivityTargetPct: 99.95,

  /** A-06: Redis connectivity target — ≥ 99.9 %. */
  redisConnectivityTargetPct: 99.9,

  /** T-01/T-02: P95/P99 ingest-to-process latency (seconds). */
  ingestLagThresholdSeconds: 30,
  ingestLagP99ThresholdSeconds: 30,

  /** T-03: Stream depth (traccar:positions) pending cap. */
  outboxBacklogThreshold: 50000,

  /** T-04: Position accept rate per pod (positions/s). */
  ingestAcceptRatePerPod: 1000,

  /** L-01: API read routes P95 latency (ms). */
  apiReadLatencyP95Ms: 200,
  /** L-02: API write routes P95 latency (ms). */
  apiWriteLatencyP95Ms: 600,
  /** L-04: Worker P95 job latency (ms). */
  workerJobLatencyP95Ms: 60000,

  /**
   * Paging burn rate (slo.md §1): a 14.4x burn rate for 2 h triggers an alarm.
   * Stored here as the canonical multi-tier value.
   */
  pagingBurnRate: 14.4,

  /**
   * Error-budget alerting thresholds (slo.md §4).
   * `acceptErrorRatePct` is the rate at which we accept/warn during peak;
   * `pageErrorRatePct` is the rate at which we page even at 3am.
   */
  acceptErrorRatePct: 0.5,
  pageErrorRatePct: 1.0,

  /** Burn-rate tiers (slo.md §4). 144× === 14.4x over the 2 h window. */
  burnRateTiers: Object.freeze([
    { multiplier: 144, durationMinutes: 120, action: "page" },
    { multiplier: 96, durationMinutes: 5, action: "page" },
    { multiplier: 36, durationMinutes: 120, action: "page" },
    { multiplier: 6, durationMinutes: 120, action: "warn" },
  ] as const satisfies readonly BurnRateTier[]),

  /** Latency SLO catalogue (slo.md §2). */
  latency: Object.freeze<Record<string, LatencySlo>>({
    L01: { id: "L-01", p95Ms: 200, target: 0.99, description: "API read routes" },
    L02: { id: "L-02", p95Ms: 600, target: 0.95, description: "API write routes" },
    L03: { id: "L-03", p95Ms: 80, target: 0.99, description: "Telemetry ingest webhook" },
    L04: { id: "L-04", p95Ms: 5000, target: 0.95, description: "Worker outbox relay" },
    L05: { id: "L-05", p95Ms: 150, target: 0.99, description: "WebSocket event fan-out" },
    L06: { id: "L-06", p95Ms: 100, target: 0.99, description: "GPS webhook → Traccar" },
  }),
});

export type SLO = typeof SLO;
