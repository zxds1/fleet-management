// packages/worker/src/ingest/backfill.ts
// Traccar REST back-fill poller (04 §4). Reconciles the last N minutes of positions into
// location_updates via the same retain/derive pipeline as the stream consumer, so both paths
// are idempotent on traccar_position_id (the UNIQUE index dedupes double delivery). This is
// also the primary durability guarantee when the pinned Traccar build lacks Redis-Stream
// forwarding (R-102). External REST calls are bounded (native fetch + AbortController) and wrapped
// in a circuit breaker so a hung or failing Traccar cannot stall or hammer the poll loop.

import { logger } from "@fleet/shared";
import { parseTraccarPosition, type TraccarPosition } from "./traccar";
import { createBreaker, fetchWithTimeout, TransportHttpError, DEFAULT_TIMEOUT_MS } from "../infra/http";

export type FetchImpl = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface BackfillDeps {
  baseUrl: string;
  username: string;
  password: string;
  lookbackMinutes: number;
  pollMinutes: number;
  fetchImpl?: FetchImpl;
  /** Bounded timeout for the Traccar REST call and circuit-breaker window (default 8s). */
  breakerTimeoutMs?: number;
  /** Receives the normalised positions; in production this is IngestConsumer.processPositions. */
  onPositions: (positions: TraccarPosition[]) => Promise<unknown>;
}

export class BackfillPoller {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly fetchImpl: FetchImpl;
  private readonly fetchWindow: (url: string, headers: Record<string, string>) => Promise<TraccarPosition[]>;

  constructor(private readonly deps: BackfillDeps) {
    const timeoutMs = deps.breakerTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetchWithTimeout(url, { headers: init.headers }, timeoutMs) as unknown as ReturnType<FetchImpl>);
    this.fetchWindow = createBreaker((url: string, headers: Record<string, string>) => this.fetchOnce(url, headers), "traccar-backfill", timeoutMs);
  }

  private async fetchOnce(url: string, headers: Record<string, string>): Promise<TraccarPosition[]> {
    const res = await this.fetchImpl(url, { headers });
    // fetchWithTimeout already throws on non-ok; an injected fetchImpl may not, so guard here too.
    if (!res.ok) throw new TransportHttpError(url, res.status);
    const raw = (await res.json()) as Record<string, unknown>[];
    return raw.map(parseTraccarPosition).filter((p) => p.vehicleId);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("back-fill poller started", { baseUrl: this.deps.baseUrl, lookback: this.deps.lookbackMinutes });
    await this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.deps.pollMinutes * 60_000);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Fetch one lookback window and forward to the pipeline. Returns the number of positions seen. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const from = new Date(now.getTime() - this.deps.lookbackMinutes * 60_000);
    const url = `${this.deps.baseUrl.replace(/\/$/, "")}/api/positions?from=${encodeURIComponent(from.toISOString())}`;
    const auth = Buffer.from(`${this.deps.username}:${this.deps.password}`).toString("base64");
    try {
      const positions = await this.fetchWindow(url, { Authorization: `Basic ${auth}` });
      if (positions.length) await this.deps.onPositions(positions);
      return positions.length;
    } catch (e) {
      if (e instanceof TransportHttpError) {
        logger.warn("back-fill request failed", { status: e.status });
      } else {
        logger.error("back-fill failed", { message: (e as Error).message });
      }
      return 0;
    }
  }
}
