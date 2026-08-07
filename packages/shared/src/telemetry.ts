// packages/shared/src/telemetry.ts
// Application telemetry (09-observability-ci.md §1): Sentry error reporting (C5.7) + a structured
// metrics collector. The Sentry reporter is a no-op until initErrorReporter() is called with a DSN,
// so unit/test processes never require a DSN or network. Metrics are kept in-process and emitted as
// structured log lines (shipped to CloudWatch Logs in AWS); a deep health probe can read the snapshot.

import * as Sentry from "@sentry/node";
import { logger } from "./logging";

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
}

let initialised = false;

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
  if (!initialised) return;
  const tags: Record<string, string> = {};
  if (ctx.error_code) tags.error_code = ctx.error_code;
  if (ctx.route) tags.route = ctx.route;
  Sentry.captureException(toError(err), {
    tags,
    user: ctx.principalId ? { id: ctx.principalId } : undefined,
    extra: { requestId: ctx.requestId },
  });
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
