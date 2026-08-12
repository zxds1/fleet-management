// packages/shared/src/telemetry.ts
// Application telemetry (09-observability-ci.md §1): Sentry error reporting (C5.7) + a structured
// metrics collector. The Sentry reporter is a no-op until initErrorReporter() is called with a DSN,
// so unit/test processes never require a DSN or network. Metrics are kept in-process and emitted as
// structured log lines (shipped to CloudWatch Logs in AWS); a deep health probe can read the snapshot.

import * as Sentry from "@sentry/node";
import { collectDefaultMetrics } from "prom-client";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logging";
import {
  initMetrics,
  appMetrics,
  httpRequestDurationM,
  httpRequestsTotalM,
  dbQueryDurationM,
  dbConnectionsM,
  redisLatencyM,
  redisStreamDepthM,
  outboxBacklogM,
  telemetryIngestTotalM,
  telemetryIngestLagSecondsM,
  workerJobsTotalM,
  workerJobDurationM,
  sentryEventsTotalM,
  errorsTotalM,
  workerDeadLetteredTotalM,
  ingestDeadLetteredTotalM,
} from "./metrics";

export interface TelemetryConfig {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  RELEASE?: string;
  SERVICE_NAME?: string;
  NODE_ENV?: string;
}

export interface ErrorContext {
  error_code?: string;
  requestId?: string;
  principalId?: string;
  route?: string;
  serviceName?: string;
  /** Severity used for the aggregation fingerprint (audit #7). Defaults to "error". */
  severity?: string;
  /** Optional precomputed fingerprint (e.g. from a persisted error event). */
  fingerprint?: string;
}

/**
 * Aggregation fingerprint (audit #7): identical (error_code|route|severity) errors collapse to one
 * "issue" so reporting can show "1 issue + count N". Severity defaults to "error".
 */
export function computeFingerprint(error_code: string | undefined, route: string | undefined, severity: string | undefined): string {
  return `${error_code ?? "UNKNOWN"}|${route ?? "unknown"}|${severity ?? "error"}`;
}

let initialised = false;
let release: string | undefined;

/** Initialises the Sentry client. Safe to call when no DSN is configured — it becomes a no-op. */
export function initErrorReporter(cfg: TelemetryConfig): boolean {
  if (initialised || !cfg.SENTRY_DSN) return initialised;
  Sentry.init({
    dsn: cfg.SENTRY_DSN,
    environment: cfg.SENTRY_ENVIRONMENT ?? cfg.NODE_ENV ?? "development",
    release: cfg.RELEASE,
    serverName: cfg.SERVICE_NAME,
    tracesSampleRate: 0,
  });
  initialised = true;
  release = cfg.RELEASE;
  return true;
}

export function isErrorReporterEnabled(): boolean {
  return initialised;
}

/**
 * Reports an error to Sentry, tagged by `error_code` (the Sentry grouping key, 09 §1) and the
 * principal id (no PII). No-op when Sentry is uninitialised.
 */
export function reportError(err: unknown, ctx: ErrorContext = {}): void {
  // Always feed the metrics collector (independent of Sentry init) so error_code volume is observed
  // even in dev/test processes where the Sentry DSN is absent. This wires the otherwise-orphaned
  // `Metrics` producer (09 §1).
  recordErrorMetric(ctx.error_code);
  const fingerprint = ctx.fingerprint ?? computeFingerprint(ctx.error_code, ctx.route, ctx.severity);
  if (!initialised) return;
  const tags: Record<string, string> = {};
  if (ctx.error_code) tags.error_code = ctx.error_code;
  if (ctx.route) tags.route = ctx.route;
  if (ctx.serviceName) tags.serviceName = ctx.serviceName;
  tags.fingerprint = fingerprint;
  if (release) tags.release = release;
  Sentry.captureException(toError(err), {
    tags,
    user: ctx.principalId ? { id: ctx.principalId } : undefined,
    extra: { requestId: ctx.requestId, fingerprint },
  });
}

/** Increments the per-error_code counters on the shared `Metrics` collector. */
export function recordErrorMetric(error_code: string | undefined, by = 1): void {
  metrics.increment("error.total", by);
  metrics.increment(`error.code.${error_code ?? "UNKNOWN"}`, by);
}

/**
 * Records the current outbox/offline-queue lag in milliseconds. Called from the mobile drainer when
 * it measures how long the oldest pending write has been queued (B13 / D-7).
 */
export function recordOutboxLagMs(ms: number): void {
  metrics.gauge("outbox.lag_ms", ms);
}

/** Records a request/operation latency in milliseconds (e.g. API round-trip). */
export function recordLatencyMs(name: string, ms: number): void {
  metrics.gauge(`latency.${name}_ms`, ms);
}

/** Drains buffered Sentry events before process exit. No-op when uninitialised. */
export async function flushTelemetry(timeoutMs = 2000): Promise<boolean> {
  if (!initialised) return true;
  return Sentry.flush(timeoutMs);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error");
}

// --- Metrics ---------------------------------------------------------------

export interface MetricSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

export interface MetricSink {
  emit(snapshot: MetricSnapshot): void;
}

/** Default sink: writes the snapshot as a structured log line (CloudWatch Logs in AWS). */
export const consoleMetricSink: MetricSink = {
  emit(snapshot) {
    logger.info("metrics snapshot", { ...snapshot });
  },
};

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private sink: MetricSink | null = null;

  setSink(sink: MetricSink | null): void {
    this.sink = sink;
  }

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): MetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  /** Emits the current snapshot to the configured sink (default: structured log). */
  flush(): void {
    if (this.sink) this.sink.emit(this.snapshot());
  }
}

export const metrics = new Metrics();

// --- Prometheus metrics ------------------------------------------------------

/**
 * Starts the Prometheus metrics subsystem: initialises the prom-client Registry,
 * registers the fleet_* metric definitions from slo.md, and collects Node.js
 * runtime default metrics. Returns an Express handler for the `/metrics` endpoint.
 *
 * Idempotent — safe to call from every entrypoint. The `httpServer` parameter
 * is accepted for forward-compatibility (server-level instrumentation); the
 * returned handler is mounted on the Express app independently.
 */
export function startMetrics(httpServer?: unknown): (req: Request, res: Response) => Promise<void> {
  if (!appMetrics.isInitialised()) {
    initMetrics();
    const registry = appMetrics.getRegistry();
    if (registry) {
      collectDefaultMetrics({ register: registry });
    }
  }

  // Touch every domain metric handle so it is registered in the Registry
  // before Prometheus scrapes /metrics.
  httpRequestDurationM();
  httpRequestsTotalM();
  dbQueryDurationM();
  dbConnectionsM();
  redisLatencyM();
  redisStreamDepthM();
  outboxBacklogM();
  telemetryIngestTotalM();
  telemetryIngestLagSecondsM();
  workerJobsTotalM();
  workerJobDurationM();
  sentryEventsTotalM();
  errorsTotalM();
  workerDeadLetteredTotalM();
  ingestDeadLetteredTotalM();

  return async (_req: Request, res: Response) => {
    res.set("Content-Type", appMetrics.contentType());
    res.end(await appMetrics.render());
  };
}

/**
 * Express middleware that records request count and latency per route
 * to the `fleet_http_requests_total` counter and
 * `fleet_http_request_duration_seconds` histogram.
 *
 * Health probes (`/healthz`, `/readyz`, `/health/deep`) and `/metrics`
 * are excluded from recording (slo.md §2 exclusion policy).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const excluded = ["/healthz", "/readyz", "/health/deep", "/metrics"];
  const path = req.originalUrl.split("?")[0] ?? req.originalUrl;

  if (excluded.includes(path)) {
    next();
    return;
  }

  const start = process.hrtime();
  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const durationSeconds = seconds + nanoseconds / 1e9;
    const status = String(res.statusCode);
    // Express sets req.route at runtime when a route matches; @types/express v4
    // types it as `any`, so we access it cautiously.
    const route: string = req.route ? String(req.route.path) : path;
    httpRequestsTotalM().inc({ method: req.method, route, status });
    httpRequestDurationM().observe({ method: req.method, route, status }, durationSeconds);
  });
  next();
}
