// packages/shared/src/tracing.ts
// Distributed tracing bootstrap (09-observability-ci.md §1). Initializes the
// OpenTelemetry SDK with an OTLP HTTP exporter and auto-instrumentations for
// http, pg, and ioredis. Safe to call without an OTLP collector — traces simply
// won't export, but the process continues normally.

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { logger } from "./logging";

let sdk: NodeSDK | null = null;

/**
 * Initialises the OpenTelemetry SDK with:
 *  - Resource: service.name = `serviceName`
 *  - Trace exporter: OTLP HTTP (endpoint from OTEL_EXPORTER_OTLP_ENDPOINT, default http://localhost:4318)
 *  - Auto-instrumentations: http, pg, ioredis
 *
 * Idempotent. Callers should call this as early as possible (before listening)
 * so http instrumentation captures all requests.
 */
export function initTracing(serviceName: string): void {
  if (sdk) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

  try {
    const resource: Resource = resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    });

    sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({
        url: endpoint,
      }),
      instrumentations: [
        new HttpInstrumentation(),
        new PgInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });

    sdk.start();
    logger.info("tracing initialised", { service: serviceName, endpoint });
  } catch (err) {
    logger.warn("tracing init failed", {
      service: serviceName,
      message: (err as Error).message,
    });
    sdk = null;
  }
}

/** Drains pending spans before process exit. No-op if tracing was never started. */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
    } catch (err) {
      logger.warn("tracing shutdown error", { message: (err as Error).message });
    } finally {
      sdk = null;
    }
  }
}
