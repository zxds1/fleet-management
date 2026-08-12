// packages/shared/src/metrics.ts
// Prometheus-style app-level metrics (09-observability-ci.md §1). Built on `prom-client`
// so the /metrics endpoint serves spec-compliant exposition for Prometheus/Grafana Cloud.
// The collector is a thin, synchronous factory — counters/histograms are created lazily on
// first use and are safe to call from any request context. A no-op stub is exported for
// test processes that never call initMetrics().

import { Counter, Histogram, Gauge, Registry, contentType as PROMETHEUS_CONTENT_TYPE } from "prom-client";
import { logger } from "./logging";

export interface MetricDefinition {
  name: string;
  help: string;
  labelNames?: string[];
}

export interface HistogramDefinition {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}

export interface CounterSpec extends MetricDefinition {}
export interface HistogramSpec extends HistogramDefinition {}
export interface GaugeSpec extends MetricDefinition {}

export interface CounterHandle {
  inc(labels?: Record<string,string>, amount?: number): void;
}
export interface HistogramHandle {
  observe(labels: Record<string, string>, value: number): void;
  observe(value: number): void;
}
export interface GaugeHandle {
  set(labels: Record<string, string>, value: number): void;
  set(value: number): void;
  inc(labels?: Record<string, string>, amount?: number): void;
  inc(amount?: number): void;
  dec(labels?: Record<string, string>, amount?: number): void;
  dec(amount?: number): void;
}

export interface MetricsCollectorLike {
  isInitialised(): boolean;
  contentType(): string;
  render(): Promise<string>;
  counter(spec: CounterSpec): CounterHandle;
  gauge(spec: GaugeSpec): GaugeHandle;
  histogram(spec: HistogramSpec): HistogramHandle;
}

const PROMETHEUS_CONTENT_TYPE_VALUE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * MetricsCollector — Prometheus-style counters, gauges, and histograms backed by prom-client.
 * The default `appMetrics` singleton is a no-op until `initMetrics()` is called.
 */
export class MetricsCollector implements MetricsCollectorLike {
  private registry: Registry | null = null;
  private counters = new Map<string, Counter<string>>();
  private gauges = new Map<string, Gauge<string>>();
  private histograms = new Map<string, Histogram<string>>();

  init(registry?: Registry): Registry {
    if (this.registry) return this.registry;
    this.registry = registry ?? new Registry();
    return this.registry;
  }

  isInitialised(): boolean {
    return this.registry !== null;
  }

  getRegistry(): Registry | null {
    return this.registry;
  }

  contentType(): string {
    return PROMETHEUS_CONTENT_TYPE_VALUE;
  }

  async render(): Promise<string> {
    if (!this.registry) return "";
    return this.registry.metrics();
  }

  counter(spec: CounterSpec): CounterHandle {
    if (!this.registry) return noopCounter();
    const existing = this.counters.get(spec.name);
    if (existing) return wrapCounter(existing);
    const c = new Counter({
      name: spec.name,
      help: spec.help,
      labelNames: spec.labelNames ?? [],
      registers: [this.registry],
    });
    this.counters.set(spec.name, c);
    return wrapCounter(c);
  }

  gauge(spec: GaugeSpec): GaugeHandle {
    if (!this.registry) return noopGauge();
    const existing = this.gauges.get(spec.name);
    if (existing) return wrapGauge(existing);
    const g = new Gauge({
      name: spec.name,
      help: spec.help,
      labelNames: spec.labelNames ?? [],
      registers: [this.registry],
    });
    this.gauges.set(spec.name, g);
    return wrapGauge(g);
  }

  histogram(spec: HistogramSpec): HistogramHandle {
    if (!this.registry) return noopHistogram();
    const existing = this.histograms.get(spec.name);
    if (existing) return wrapHistogram(existing);
    const h = new Histogram({
      name: spec.name,
      help: spec.help,
      labelNames: spec.labelNames ?? [],
      buckets: spec.buckets,
      registers: [this.registry],
    });
    this.histograms.set(spec.name, h);
    return wrapHistogram(h);
  }
}

function wrapCounter(c: Counter<string>): CounterHandle {
  return {
    inc(labels?: Record<string, string>, amount?: number): void {
      if (amount !== undefined && labels !== undefined) c.inc(labels, amount);
      else if (labels !== undefined) c.inc(labels);
      else c.inc();
    },
  };
}

function wrapGauge(g: Gauge<string>): GaugeHandle {
  return {
    set: ((arg: Record<string, string> | number, val?: number) => {
      if (typeof arg === "number") g.set(arg);
      else g.set(arg, val!);
    }) as GaugeHandle["set"],
    inc: ((arg?: Record<string, string> | number, amount?: number) => {
      if (arg === undefined) g.inc();
      else if (typeof arg === "number") g.inc(arg);
      else g.inc(arg, amount);
    }) as GaugeHandle["inc"],
    dec: ((arg?: Record<string, string> | number, amount?: number) => {
      if (arg === undefined) g.dec();
      else if (typeof arg === "number") g.dec(arg);
      else g.dec(arg, amount);
    }) as GaugeHandle["dec"],
  };
}

function wrapHistogram(h: Histogram<string>): HistogramHandle {
  return {
    observe: ((arg: Record<string, string> | number, val?: number) => {
      if (typeof arg === "number") h.observe(arg);
      else h.observe(arg, val!);
    }) as HistogramHandle["observe"],
  };
}

const noopCounter = (): CounterHandle => ({
  inc: () => {},
});
const noopGauge = (): GaugeHandle => ({
  set: (() => {}) as GaugeHandle["set"],
  inc: (() => {}) as GaugeHandle["inc"],
  dec: (() => {}) as GaugeHandle["dec"],
});
const noopHistogram = (): HistogramHandle => ({
  observe: (() => {}) as HistogramHandle["observe"],
});

/** The shared singleton. Call initMetrics() at boot; metrics are no-ops until then. */
export const appMetrics = new MetricsCollector();

/** Call once at startup to enable collection. */
export function initMetrics(): MetricsCollector {
  appMetrics.init();
  return appMetrics;
}

// ── Domain metric definitions ────────────────────────────────────────────────

export const httpRequestDuration = (m: MetricsCollector): HistogramHandle =>
  m.histogram({
    name: "fleet_http_request_duration_seconds",
    help: "HTTP request latency (server-side, excluding health probes)",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

export const httpRequestsTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_http_requests_total",
    help: "Total HTTP requests by method, route, and status",
    labelNames: ["method", "route", "status"],
  });

export const dbQueryDuration = (m: MetricsCollector): HistogramHandle =>
  m.histogram({
    name: "fleet_db_query_duration_seconds",
    help: "Database query latency",
    labelNames: ["operation"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

export const dbConnections = (m: MetricsCollector): GaugeHandle =>
  m.gauge({
    name: "fleet_db_connections",
    help: "Active database connections",
    labelNames: ["state"],
  });

export const redisLatency = (m: MetricsCollector): HistogramHandle =>
  m.histogram({
    name: "fleet_redis_latency_seconds",
    help: "Redis command latency",
    labelNames: ["command", "status"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

export const redisStreamDepth = (m: MetricsCollector): GaugeHandle =>
  m.gauge({
    name: "fleet_redis_stream_depth",
    help: "Pending items in a Redis stream",
    labelNames: ["stream"],
  });

export const outboxBacklog = (m: MetricsCollector): GaugeHandle =>
  m.gauge({
    name: "fleet_outbox_backlog",
    help: "Number of unprocessed outbox events",
    labelNames: ["status"],
  });

export const telemetryIngestTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_telemetry_ingest_total",
    help: "Total telemetry positions accepted by the ingest webhook",
    labelNames: ["result"],
  });

export const telemetryIngestLagSeconds = (m: MetricsCollector): GaugeHandle =>
  m.gauge({
    name: "fleet_telemetry_ingest_lag_seconds",
    help: "Seconds between the newest accepted position and now",
  });

export const workerJobsTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_worker_jobs_total",
    help: "Total worker jobs processed by type and result",
    labelNames: ["job", "result"],
  });

export const workerJobDuration = (m: MetricsCollector): HistogramHandle =>
  m.histogram({
    name: "fleet_worker_job_duration_seconds",
    help: "Worker job processing duration",
    labelNames: ["job"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  });

export const sentryEventsTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_sentry_events_total",
    help: "Errors and transactions sent to Sentry",
    labelNames: ["category", "level"],
  });

export const errorsTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_errors_total",
    help: "Total application errors by error_code",
    labelNames: ["error_code", "route"],
  });

export const workerDeadLetteredTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_worker_dead_lettered_total",
    help: "Total worker jobs that exhausted retries (dead-lettered)",
    labelNames: ["job", "stream"],
  });

export const ingestDeadLetteredTotal = (m: MetricsCollector): CounterHandle =>
  m.counter({
    name: "fleet_ingest_dead_lettered_total",
    help: "Total telemetry positions that were dead-lettered (discarded/malformed)",
    labelNames: ["stream"],
  });

// ── Lazy handles that resolve against the shared singleton ────────────────────

let _httpRequestDuration: HistogramHandle | null = null;
let _httpRequestsTotal: CounterHandle | null = null;
let _dbQueryDuration: HistogramHandle | null = null;
let _dbConnections: GaugeHandle | null = null;
let _redisLatency: HistogramHandle | null = null;
let _redisStreamDepth: GaugeHandle | null = null;
let _outboxBacklog: GaugeHandle | null = null;
let _telemetryIngestTotal: CounterHandle | null = null;
let _telemetryIngestLagSeconds: GaugeHandle | null = null;
let _workerJobsTotal: CounterHandle | null = null;
let _workerJobDuration: HistogramHandle | null = null;
let _sentryEventsTotal: CounterHandle | null = null;
let _errorsTotal: CounterHandle | null = null;
let _workerDeadLetteredTotal: CounterHandle | null = null;
let _ingestDeadLetteredTotal: CounterHandle | null = null;

export function httpRequestDurationM(): HistogramHandle {
  return _httpRequestDuration ??= httpRequestDuration(appMetrics);
}
export function httpRequestsTotalM(): CounterHandle {
  return _httpRequestsTotal ??= httpRequestsTotal(appMetrics);
}
export function dbQueryDurationM(): HistogramHandle {
  return _dbQueryDuration ??= dbQueryDuration(appMetrics);
}
export function dbConnectionsM(): GaugeHandle {
  return _dbConnections ??= dbConnections(appMetrics);
}
export function redisLatencyM(): HistogramHandle {
  return _redisLatency ??= redisLatency(appMetrics);
}
export function redisStreamDepthM(): GaugeHandle {
  return _redisStreamDepth ??= redisStreamDepth(appMetrics);
}
export function outboxBacklogM(): GaugeHandle {
  return _outboxBacklog ??= outboxBacklog(appMetrics);
}
export function telemetryIngestTotalM(): CounterHandle {
  return _telemetryIngestTotal ??= telemetryIngestTotal(appMetrics);
}
export function telemetryIngestLagSecondsM(): GaugeHandle {
  return _telemetryIngestLagSeconds ??= telemetryIngestLagSeconds(appMetrics);
}
export function workerJobsTotalM(): CounterHandle {
  return _workerJobsTotal ??= workerJobsTotal(appMetrics);
}
export function workerJobDurationM(): HistogramHandle {
  return _workerJobDuration ??= workerJobDuration(appMetrics);
}
export function sentryEventsTotalM(): CounterHandle {
  return _sentryEventsTotal ??= sentryEventsTotal(appMetrics);
}
export function errorsTotalM(): CounterHandle {
  return _errorsTotal ??= errorsTotal(appMetrics);
}
export function workerDeadLetteredTotalM(): CounterHandle {
  return _workerDeadLetteredTotal ??= workerDeadLetteredTotal(appMetrics);
}
export function ingestDeadLetteredTotalM(): CounterHandle {
  return _ingestDeadLetteredTotal ??= ingestDeadLetteredTotal(appMetrics);
}

export { PROMETHEUS_CONTENT_TYPE_VALUE };
