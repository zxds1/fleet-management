// packages/mobile/src/core/offlineQueue/drainer.ts
//
// Serial drainer (D-5/D-7). Replays PENDING/INFLIGHT items one at a time (no interleaving — an
// idempotency key must never be in flight twice). Each replay goes through `ApiClient.send` with the
// item's frozen `idempotencyKey`; the response decides the next state via `OfflineQueue.markFailed`
// (discard / retry / failed_review / reauth). A `reauth` result bubbles up so the app forces re-login
// (B13). Backoff is exponential on `retry`. The drainer is pure over injected ports (testable).

import { ApiClient, ApiError } from "../apiClient";
import { OfflineQueue } from "./index";
import type { OutboxItem } from "./types";

export interface DrainerDeps {
  queue: OfflineQueue;
  api: ApiClient;
  /** False when offline — the drainer parks itself. */
  isOnline: () => boolean;
  /** Milliseconds to wait between attempts on a `retry` item; base * 2^attempts. */
  backoffBaseMs?: number;
  /** Injected clock for tests. */
  now?: () => number;
  /** Called after each item resolves, so the UI can refresh counts. */
  onItemResolved?: (item: OutboxItem, outcome: "done" | "retry" | "failed_review" | "discarded" | "reauth") => void;
  /** Called when a fatal reauth code is hit. */
  onReauth?: (code: string) => void;
  /** Min gap between full drain cycles while online. */
  pollMs?: number;
}

export class Drainer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly deps: DrainerDeps) {}

  /** Starts the periodic drain loop. */
  start() {
    this.stopped = false;
    this.schedule(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.cycle(), ms);
  }

  /** One drain cycle: replay every eligible item serially. */
  async cycle(): Promise<void> {
    if (this.running || this.stopped) return;
    if (!this.deps.isOnline()) {
      this.schedule(this.deps.pollMs ?? 5000);
      return;
    }
    this.running = true;
    try {
      const items = await this.deps.queue.list();
      for (const item of items) {
        if (item.status !== "PENDING" && item.status !== "INFLIGHT") continue;
        if (this.stopped || !this.deps.isOnline()) break;
        await this.replay(item);
      }
    } finally {
      this.running = false;
    }
    if (!this.stopped) this.schedule(this.deps.pollMs ?? 5000);
  }

  private async replay(item: OutboxItem) {
    try {
      await this.deps.api.send(item.method, item.path, item.body, item.idempotencyKey);
      await this.deps.queue.markDone(item.id);
      this.deps.onItemResolved?.(item, "done");
    } catch (err) {
      const code = err instanceof ApiError ? err.appError.code : "UNKNOWN";
      const outcome = await this.deps.queue.markFailed(item, code);
      this.deps.onItemResolved?.(item, outcome);
      if (outcome === "reauth") {
        this.deps.onReauth?.(code);
        this.stop();
      }
    }
  }
}
