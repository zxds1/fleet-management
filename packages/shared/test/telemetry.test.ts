// packages/shared/test/telemetry.test.ts
// Covers the Sentry reporter no-op contract (no DSN) and the in-process metrics collector.
import {
  initErrorReporter,
  isErrorReporterEnabled,
  reportError,
  flushTelemetry,
  Metrics,
  metrics,
  consoleMetricSink,
  type MetricSnapshot,
} from "../src/telemetry";

describe("error reporter (C5.7)", () => {
  it("is a no-op when no DSN is configured", () => {
    expect(initErrorReporter({})).toBe(false);
    expect(isErrorReporterEnabled()).toBe(false);
    // Must not throw even though Sentry is uninitialised.
    expect(() => reportError(new Error("boom"))).not.toThrow();
    expect(() => reportError("string error", { error_code: "X" })).not.toThrow();
  });

  it("reports without throwing once initialised with a DSN", async () => {
    expect(initErrorReporter({ SENTRY_DSN: "https://public@o1.ingest.sentry.io/1" })).toBe(true);
    expect(isErrorReporterEnabled()).toBe(true);
    expect(() =>
      reportError(new Error("wired"), { error_code: "CLOCKOUT_PENDING", principalId: "u1", requestId: "r1" }),
    ).not.toThrow();
    await expect(flushTelemetry(1)).resolves.toBeDefined();
  });
});

describe("metrics collector", () => {
  it("increments, gauges and snapshots", () => {
    const m = new Metrics();
    m.increment("error.ODOMETER_DECREASED");
    m.increment("error.ODOMETER_DECREASED", 2);
    m.gauge("route.latency_ms", 12);
    const snap: MetricSnapshot = m.snapshot();
    expect(snap.counters["error.ODOMETER_DECREASED"]).toBe(3);
    expect(snap.gauges["route.latency_ms"]).toBe(12);
  });

  it("flushes to a custom sink", () => {
    const m = new Metrics();
    const emitted: MetricSnapshot[] = [];
    m.setSink({ emit: (s) => emitted.push(s) });
    m.increment("x");
    m.flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.counters["x"]).toBe(1);
  });

  it("uses the console sink by default", () => {
    metrics.increment("telemetry.test");
    expect(() => metrics.flush()).not.toThrow();
    // restore default no-op behaviour is not required; increment is idempotent-ish
  });

  it("exposes a consoleMetricSink", () => {
    expect(() => consoleMetricSink.emit({ counters: {}, gauges: {} })).not.toThrow();
  });
});
