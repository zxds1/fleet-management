// packages/mobile/src/core/offlineQueue/index.ts
//
// Offline queue control surface. Pure logic over a `QueueStore` (no React, no native). The drainer
// and disposition handling implement D-7:
//   • discard        → DUPLICATE / IDEMPOTENCY_CONFLICT: drop silently (toast handled by UI)
//   • retry          → transient: keep PENDING, exponential backoff (NOT in this module)
//   • failed_review  → hard domain: move to FAILED_REVIEW, surface in Outbox
//   • reauth         → fatal session codes: caller forces re-login (B13)
//
// Phase 4 adds the expo-sqlite store + the serialized drain loop; this module defines the operations
// the rest of the app calls (enqueue, discard, relabel, counts).

import { randomUUID } from "../uuid";
import type { OutboxItem, QueueStore, OutboxCounts, HttpMethod } from "./types";
import { countItems } from "./types";
import { dispositionFor } from "../errorCodes";

export interface EnqueueInput {
  method: HttpMethod;
  path: string;
  body: unknown;
  label?: string;
  /** Allow callers to reuse a key (rare); otherwise one is minted. */
  idempotencyKey?: string;
  /** Override the clock for tests. */
  now?: () => string;
}

export class OfflineQueue {
  constructor(private readonly store: QueueStore) {}

  async enqueue(input: EnqueueInput): Promise<OutboxItem> {
    const item: OutboxItem = {
      id: randomUUID(),
      method: input.method,
      path: input.path,
      body: input.body,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      status: "PENDING",
      attempts: 0,
      queuedAt: input.now ? input.now() : new Date().toISOString(),
      label: input.label,
    };
    await this.store.put(item);
    return item;
  }

  async list(): Promise<OutboxItem[]> {
    return this.store.all();
  }

  async counts(): Promise<OutboxCounts> {
    return countItems(await this.store.all());
  }

  /** D-7: discard an item (user or duplicate). Returns whether it existed. */
  async discard(id: string): Promise<boolean> {
    const item = await this.store.get(id);
    if (!item) return false;
    await this.store.delete(id);
    return true;
  }

  /** Called by the drainer after a failed replay. Applies the D-7 disposition. */
  async markFailed(item: OutboxItem, errorCode: string): Promise<"discarded" | "retry" | "failed_review" | "reauth"> {
    const disposition = dispositionFor(errorCode);
    if (disposition === "discard") {
      await this.store.delete(item.id);
      return "discarded";
    }
    if (disposition === "reauth") {
      await this.store.delete(item.id);
      return "reauth";
    }
    const next: OutboxItem = {
      ...item,
      status: disposition === "failed_review" ? "FAILED_REVIEW" : "PENDING",
      attempts: item.attempts + 1,
      lastError: errorCode,
    };
    await this.store.put(next);
    return disposition === "failed_review" ? "failed_review" : "retry";
  }

  async markDone(id: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) return;
    await this.store.delete(id);
  }

  /** True when the oldest PENDING item is older than `maxHours` (24h offline ceiling, B13). */
  async exceedsOfflineCeiling(maxHours = 24, now: () => number = () => Date.now()): Promise<boolean> {
    const items = await this.store.all();
    const pending = items.filter((i) => i.status === "PENDING" || i.status === "INFLIGHT");
    if (pending.length === 0) return false;
    const oldest = pending.reduce((min, i) => Math.min(min, Date.parse(i.queuedAt)), Number.MAX_SAFE_INTEGER);
    return now() - oldest > maxHours * 3600 * 1000;
  }
}

export type { OutboxItem, OutboxStatus, OutboxCounts, QueueStore, HttpMethod } from "./types";
