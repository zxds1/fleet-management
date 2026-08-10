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
  /** Driver-scoped shift events (clock-in/out accepted, HOS changes, close-out required). */
  driverShift: "ws:driver:shift",
  /** Driver-scoped vehicle display-state for the driver's own assignment. */
  driverVehicle: "ws:driver:vehicle",
  /** Driver-scoped accident events (acknowledgement, escalation tier changes on their own report). */
  driverAccident: "ws:driver:accident",
} as const;

export type RealtimeChannel = (typeof RealtimeChannels)[keyof typeof RealtimeChannels];

/**
 * Wire event names the gateway actually emits over the socket. These are the *unprefixed*
 * counterparts of `RealtimeChannels` (no `ws:` topic prefix) — the client subscribes to and
 * listens on these, while callers address handlers by the `RealtimeChannel` constant. `EVENT_FOR_CHANNEL`
 * bridges the two so a channel rename touches exactly one place.
 */
export const RealtimeEvents = {
  vehicleStates: "map:vehicle-states",
  notifications: "notifications",
  accidentLive: "accident:live",
  driverShift: "driver:shift",
  driverVehicle: "driver:vehicle",
  driverAccident: "driver:accident",
} as const;

/** `RealtimeChannel` → wire event name. Keys mirror `RealtimeChannels` 1:1. */
export const EVENT_FOR_CHANNEL = {
  [RealtimeChannels.vehicleStates]: RealtimeEvents.vehicleStates,
  [RealtimeChannels.notifications]: RealtimeEvents.notifications,
  [RealtimeChannels.accidentLive]: RealtimeEvents.accidentLive,
  [RealtimeChannels.driverShift]: RealtimeEvents.driverShift,
  [RealtimeChannels.driverVehicle]: RealtimeEvents.driverVehicle,
  [RealtimeChannels.driverAccident]: RealtimeEvents.driverAccident,
} as const satisfies Record<RealtimeChannel, string>;

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
