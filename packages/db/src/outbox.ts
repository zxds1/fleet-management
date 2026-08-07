// packages/db/src/outbox.ts
// OutboxRelay bound to app.outbox_events (D8). Polls for unpublished, due rows in priority
// order, invokes the registered handler, and marks published_at on success or bumps attempts /
// dead-letters on failure. At-least-once: a crash between publish and ack re-delivers, so
// handlers MUST be idempotent (01 §6).

import type { OutboxEvent, OutboxHandler, OutboxRelay, PoolLike } from "@fleet/shared";

const SELECT_DUE = `
  SELECT *
  FROM app.outbox_events
  WHERE published_at IS NULL AND available_at <= now()
  ORDER BY (CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END), id
  LIMIT $1`;

const MARK_PUBLISHED = `UPDATE app.outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = $1`;
const MARK_FAILED = `
  UPDATE app.outbox_events
  SET attempts = $1, last_error = $2, dead_lettered_at = CASE WHEN $3 THEN now() ELSE NULL END
  WHERE id = $4`;

export interface OutboxRelayOptions {
  intervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
}

export class PgOutboxRelay implements OutboxRelay {
  private readonly handlers = new Map<string, OutboxHandler>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly pool: PoolLike,
    private readonly opts: OutboxRelayOptions = {},
  ) {}

  registerHandler(eventType: string, handler: OutboxHandler): void {
    this.handlers.set(eventType, handler);
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.intervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.poll();
    }, interval);
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const client = await this.pool.connect();
    try {
      const res = await client.query<OutboxEvent>(SELECT_DUE, [this.opts.batchSize ?? 50]);
      for (const ev of res.rows) {
        const handler = this.handlers.get(ev.event_type);
        try {
          if (handler) await handler(ev);
          await client.query(MARK_PUBLISHED, [ev.id]);
        } catch (e) {
          const attempts = ev.attempts + 1;
          const dead = attempts >= (this.opts.maxAttempts ?? 5);
          await client.query(MARK_FAILED, [attempts, (e as Error).message, dead, ev.id]);
        }
      }
    } finally {
      client.release?.();
      this.running = false;
    }
  }
}
