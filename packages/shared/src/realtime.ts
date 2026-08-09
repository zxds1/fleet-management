// packages/shared/src/realtime.ts
// Real-time channel contract shared by event PRODUCERS (@fleet/api, @fleet/worker) and the
// @fleet/ws gateway (07-websocket-gateway.md). Topic names are the single source of truth; payloads
// are JSON-serialisable. Keeping this in @fleet/shared (no new runtime deps) lets both sides import
// identical constants instead of duplicating string literals.
//
// Two namespaces live here and must not be confused:
//   • `RealtimeChannels` — `ws:`-prefixed Redis pub/sub topics (producer → gateway).
//   • `RealtimeEvents`   — unprefixed Socket.IO event names (gateway → connected client).
// `EVENT_FOR_CHANNEL` translates between them.

export const RealtimeChannels = {
  /** Recompute + diff the vehicle display-state view (triggered by tracker_health / shift / HOS change). */
  vehicleStates: "ws:map:vehicle-states",
  /** Push a freshly-created notification to its recipient (payload: { userId, notification }). */
  notifications: "ws:notifications",
  /** Push a live accident event to the on-call roster (payload: accident event). */
  accidentLive: "ws:accident:live",
} as const;

export type RealtimeChannel = (typeof RealtimeChannels)[keyof typeof RealtimeChannels];

/**
 * Client-facing Socket.IO event names emitted by the @fleet/ws gateway (07 §3). These are a
 * DIFFERENT namespace from `RealtimeChannels`: the latter are Redis pub/sub topics between the
 * producers (@fleet/api, @fleet/worker) and the gateway, while these are what a connected client
 * listens for. The `ws:` prefix exists to namespace the Redis keyspace and must not leak onto the
 * wire, so the two maps are keyed identically and translated by the gateway.
 */
export const RealtimeEvents = {
  vehicleStates: "map:vehicle-states",
  notifications: "notifications",
  accidentLive: "accident:live",
  driverShift: "driver:shift",
  driverVehicle: "driver:vehicle",
  driverAccident: "driver:accident",
} as const;

export type RealtimeEvent = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

/** Maps a Redis bus topic to the client-facing event name the gateway emits. */
export const EVENT_FOR_CHANNEL: Record<RealtimeChannel, RealtimeEvent> = {
  [RealtimeChannels.vehicleStates]: RealtimeEvents.vehicleStates,
  [RealtimeChannels.notifications]: RealtimeEvents.notifications,
  [RealtimeChannels.accidentLive]: RealtimeEvents.accidentLive,
  [RealtimeChannels.driverShift]: RealtimeEvents.driverShift,
  [RealtimeChannels.driverVehicle]: RealtimeEvents.driverVehicle,
  [RealtimeChannels.driverAccident]: RealtimeEvents.driverAccident,
};

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
