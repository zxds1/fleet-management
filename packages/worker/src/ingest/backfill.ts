// packages/worker/src/ingest/backfill.ts
// Traccar REST back-fill poller (04 §4). Reconciles the last N minutes of positions into
// location_updates via the same retain/derive pipeline as the stream consumer, so both paths
// are idempotent on traccar_position_id (the UNIQUE index dedupes double delivery). This is
// also the primary durability guarantee when the pinned Traccar build lacks Redis-Stream
// forwarding (R-102).

import { logger } from "@fleet/shared";
import { parseTraccarPosition, type TraccarPosition } from "./traccar";

export type FetchImpl = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface BackfillDeps {
  baseUrl: string;
  username: string;
  password: string;
  lookbackMinutes: number;
  pollMinutes: number;
  fetchImpl?: FetchImpl;
  /** Receives the normalised positions; in production this is IngestConsumer.processPositions. */
  onPositions: (positions: TraccarPosition[]) => Promise<unknown>;
}

export class BackfillPoller {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly fetchImpl: FetchImpl;

  constructor(private readonly deps: BackfillDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, { headers: init.headers }) as unknown as ReturnType<FetchImpl>);
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
      const res = await this.fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) {
        logger.warn("back-fill request failed", { status: res.status });
        return 0;
      }
      const raw = (await res.json()) as Record<string, unknown>[];
      const positions = raw.map(parseTraccarPosition).filter((p) => p.vehicleId);
      if (positions.length) await this.deps.onPositions(positions);
      return positions.length;
    } catch (e) {
      logger.error("back-fill failed", { message: (e as Error).message });
      return 0;
    }
  }
}
