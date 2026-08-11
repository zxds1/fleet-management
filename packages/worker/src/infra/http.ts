// packages/worker/src/infra/http.ts
// Bounded HTTP helper + circuit breaker for external calls (FCM / Africa's Talking / email /
// Traccar REST). Every external call gets a native fetch + AbortController timeout so a hung
// downstream cannot stall the worker loop, and a per-transport circuit breaker fails fast once a
// downstream is unhealthy. Failures surface as errors the existing outbox / back-fill paths
// already treat as transient (markFailed → retry).

import CircuitBreaker from "opossum";
import { logger } from "@fleet/shared";

export const DEFAULT_TIMEOUT_MS = 8_000;
export const BREAKER_VOLUME_THRESHOLD = 5;

/** Thrown when a downstream call exceeds its bounded timeout (native fetch + AbortController). */
export class TransportTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`Transport call to ${url} timed out after ${timeoutMs}ms`);
    this.name = "TransportTimeoutError";
  }
}

/** Thrown for a completed-but-non-ok HTTP response. Carries the status so the breaker can ignore
 *  4xx (caller error) and only count 5xx / network / timeout errors toward opening. */
export class TransportHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`Transport call to ${url} failed with status ${status}`);
    this.name = "TransportHttpError";
  }
}

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}

/** Native fetch with a per-call AbortController timeout. Resolves only on a 2xx response; throws
 *  a TransportTimeoutError on abort/timeout and a TransportHttpError on any non-ok status so both
 *  the caller and the circuit breaker can treat them as failures. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new TransportHttpError(url, res.status);
    return res;
  } catch (e) {
    if (e instanceof TransportHttpError) throw e;
    // fetch rejects with an AbortError (an Error under undici, a DOMException in some runtimes)
    // when our timeout fires — normalise both to the typed, retryable TransportTimeoutError.
    if (isAbortError(e)) throw new TransportTimeoutError(url, timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Build the outbox failureReason string, preserving the legacy `LABEL <status>` shape for HTTP
 *  errors and using the error message for timeouts / open breaker / network faults. */
export function transportFailureReason(label: string, e: unknown): string {
  if (e instanceof TransportHttpError) return `${label} ${e.status}`;
  return e instanceof Error ? e.message : String(e);
}

/** Wrap an external call in an opossum circuit breaker. Once at least `volumeThreshold` calls have
 *  run in the rolling window and `errorThresholdPercentage` of them failed, the breaker OPENS and
 *  rejects fast (rather than hammering a failing downstream) until it half-opens after
 *  `resetTimeout`. 4xx `TransportHttpError`s are excluded via `errorFilter`: they are caller
 *  errors, not downstream outages, so they must not trip the breaker. */
export function createBreaker<TArgs extends unknown[], TR>(
  action: (...args: TArgs) => Promise<TR>,
  name: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): (...args: TArgs) => Promise<TR> {
  const breaker = new CircuitBreaker(action, {
    name,
    timeout: timeoutMs,
    errorThresholdPercentage: 50,
    resetTimeout: 10_000,
    rollingCountTimeout: 10_000,
    volumeThreshold: BREAKER_VOLUME_THRESHOLD,
    errorFilter: (err: unknown) => err instanceof TransportHttpError && err.status >= 400 && err.status < 500,
  });
  breaker.on("open", () => logger.warn("circuit breaker open", { transport: name }));
  breaker.on("halfOpen", () => logger.info("circuit breaker half-open", { transport: name }));
  breaker.on("close", () => logger.info("circuit breaker closed", { transport: name }));
  return (...args: TArgs) => breaker.fire(...args) as Promise<TR>;
}
