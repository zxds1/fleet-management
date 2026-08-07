// packages/ws/src/pubsub.ts
// Fan-out bridge between backend state changes and the gateway's Socket.IO rooms (07 §3/§5). The
// worker (or api) publishes change events; the gateway subscribes and re-broadcasts to the
// subscribed rooms. Redis is the production transport; an in-memory bus is used in tests.

import Redis from "ioredis";
import { logger, RealtimeChannels as Channels } from "@fleet/shared";

export type EventHandler = (payload: unknown) => void;

export interface EventBus {
  publish(channel: string, payload: unknown): Promise<void>;
  subscribe(channel: string, handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}

/** Channel namespacing — imported from @fleet/shared so producers + consumer agree on topic keys.
 * Payloads carry the user/incident scope so a single subscription per topic fans out to the right
 * room (07 §3/§5). */
export { Channels };

export class MemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish(channel: string, payload: unknown): Promise<void> {
    const subs = this.handlers.get(channel);
    if (!subs) return;
    for (const h of [...subs]) {
      try {
        h(payload);
      } catch (e) {
        logger.warn("memory bus handler failed", { message: (e as Error).message });
      }
    }
  }

  async subscribe(channel: string, handler: EventHandler): Promise<void> {
    const set = this.handlers.get(channel) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(channel, set);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

export class RedisEventBus implements EventBus {
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private closed = false;

  constructor(private readonly url: string) {
    this.sub = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    this.sub.on("error", (err) => logger.warn("eventbus redis error", { message: err.message }));
    this.sub.on("message", (channel, message) => {
      let payload: unknown = message;
      try {
        payload = JSON.parse(message);
      } catch {
        /* keep raw string */
      }
      for (const h of this.handlers.get(channel) ?? []) {
        try {
          h(payload);
        } catch (e) {
          logger.warn("eventbus handler failed", { message: (e as Error).message });
        }
      }
    });
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.closed) return;
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    try {
      await this.sub.publish(channel, body);
    } catch (e) {
      logger.warn("eventbus publish failed", { message: (e as Error).message });
    }
  }

  async subscribe(channel: string, handler: EventHandler): Promise<void> {
    const set = this.handlers.get(channel) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(channel, set);
    if (!this.closed) {
      try {
        await this.sub.subscribe(channel);
      } catch (e) {
        logger.warn("eventbus subscribe failed", { message: (e as Error).message });
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.sub.quit();
    } catch {
      this.sub.disconnect();
    }
  }
}
