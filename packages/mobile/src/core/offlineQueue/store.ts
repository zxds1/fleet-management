// packages/mobile/src/core/offlineQueue/store.ts
//
// In-memory QueueStore. Phase 4 replaces this with an expo-sqlite-backed implementation behind the
// same `QueueStore` interface so the queue logic below is unchanged. The memory store keeps a
// synchronous map but exposes the async interface the rest of the app depends on.

import type { OutboxItem, QueueStore } from "./types";

export function createMemoryStore(initial: OutboxItem[] = []): QueueStore {
  const map = new Map<string, OutboxItem>();
  for (const it of initial) map.set(it.id, it);
  return {
    async all() {
      return [...map.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
    async get(id) {
      return map.get(id);
    },
    async put(item) {
      map.set(item.id, item);
    },
    async delete(id) {
      map.delete(id);
    },
  };
}

/** Backed by a caller-provided map for deterministic tests. */
export function createMapStore(map: Map<string, OutboxItem>): QueueStore {
  return {
    async all() {
      return [...map.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
    async get(id) {
      return map.get(id);
    },
    async put(item) {
      map.set(item.id, item);
    },
    async delete(id) {
      map.delete(id);
    },
  };
}
