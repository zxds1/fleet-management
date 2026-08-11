// packages/mobile/src/core/offlineQueue/types.ts
//
// Durable offline queue (D-5/D-7). The *shape* of an outbox item is frozen by the design: it carries
// the original request, a client-generated idempotency key (C5.1), a state machine, attempts, and a
// `queued_at`. The actual persistence (expo-sqlite) is attached in Phase 4 via the `QueueStore`
// port below so this module stays pure and unit-testable in node.

export type OutboxStatus =
  | "PENDING" // queued, waiting for network
  | "INFLIGHT" // being sent right now
  | "FAILED_REVIEW" // hard domain error; user must edit/retry/discard
  | "DONE"; // server accepted

/** Outbox items are state-changing writes only — GETs are never queued. */
export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface OutboxItem {
  id: string;
  method: HttpMethod;
  path: string;
  /** Parsed/normalizable body; never contains secrets (C5.3). */
  body: unknown;
  /** Idempotency-Key header value (uuid). Frozen for the life of the item. */
  idempotencyKey: string;
  status: OutboxStatus;
  attempts: number;
  /** ISO timestamp. Used for the 24h offline ceiling → forced re-login (B13). */
  queuedAt: string;
  /** Most recent error code, if any. */
  lastError?: string;
  /** Arbitrary label for the Outbox UI (human, localized at render time). */
  label?: string;
}

export interface OutboxCounts {
  pending: number;
  inflight: number;
  failedReview: number;
  done: number;
  total: number;
}

export interface QueueStore {
  all(): Promise<OutboxItem[]>;
  get(id: string): Promise<OutboxItem | undefined>;
  put(item: OutboxItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export function countItems(items: OutboxItem[]): OutboxCounts {
  const counts: OutboxCounts = { pending: 0, inflight: 0, failedReview: 0, done: 0, total: items.length };
  for (const it of items) {
    if (it.status === "PENDING") counts.pending++;
    else if (it.status === "INFLIGHT") counts.inflight++;
    else if (it.status === "FAILED_REVIEW") counts.failedReview++;
    else if (it.status === "DONE") counts.done++;
  }
  return counts;
}
