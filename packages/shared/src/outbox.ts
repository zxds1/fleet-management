// packages/shared/src/outbox.ts
// OutboxRelay contract (D8). Drains app.outbox_events post-commit; handlers must be
// idempotent because exactly-once delivery is not guaranteed (01-shared-kernel.md §6).

export interface OutboxEvent {
  id: bigint;
  event_type: string;
  aggregate_type: string;
  aggregate_id?: string;
  payload: Record<string, unknown>;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  occurred_at: Date;
  available_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
  dead_lettered_at: Date | null;
}

export type OutboxHandler = (ev: OutboxEvent) => Promise<void>;

export interface OutboxRelay {
  start(): void;
  registerHandler(eventType: string, handler: OutboxHandler): void;
  stop(): Promise<void>;
}
