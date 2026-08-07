// packages/shared/src/realtime.ts
// Real-time channel contract shared by event PRODUCERS (@fleet/api, @fleet/worker) and the
// @fleet/ws gateway (07-websocket-gateway.md). Topic names are the single source of truth; payloads
// are JSON-serialisable. Keeping this in @fleet/shared (no new runtime deps) lets both sides import
// identical constants instead of duplicating string literals.

export const RealtimeChannels = {
  /** Recompute + diff the vehicle display-state view (triggered by tracker_health / shift / HOS change). */
  vehicleStates: "ws:map:vehicle-states",
  /** Push a freshly-created notification to its recipient (payload: { userId, notification }). */
  notifications: "ws:notifications",
  /** Push a live accident event to the on-call roster (payload: accident event). */
  accidentLive: "ws:accident:live",
} as const;

export type RealtimeChannel = (typeof RealtimeChannels)[keyof typeof RealtimeChannels];

export interface EventPublisher {
  publish(channel: string, payload: unknown): Promise<void>;
}

/** Minimal structural shape of an ioredis client we need (avoids a hard ioredis dependency). */
export interface RedisPub {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Builds an EventPublisher from a Redis client. Null-safe: becomes a no-op when Redis is absent
 * (the gateway then relies on its (re)connect snapshot, 07 §5). */
export function redisPublisher(client: RedisPub | null): EventPublisher {
  return {
    async publish(channel, payload) {
      if (!client) return;
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      try {
        await client.publish(channel, body);
      } catch {
        /* best effort — real-time push is not a durable side effect */
      }
    },
  };
}
