/**
 * Socket layer, aligned with `fleet-management/packages/ws/src/gateway.ts`.
 *
 * What changed from the reference the app was written against:
 *  • The gateway decides rooms from the verified Principal; there is NO client `subscribe`. It emits
 *    six events: `map:vehicle-states`, `notifications`, `accident:live`, `driver:shift`,
 *    `driver:vehicle`, `driver:accident`.
 *  • Driver rooms are keyed by the DRIVER id (`app.drivers.id`), never by shiftId, vehicleId or userId.
 *  • On (re)connect the gateway re-emits the current state: the whole vehicle snapshot for an admin
 *    client, and the driver's own vehicle row + shift row + unread notifications. There is no
 *    `snapshot` envelope with named keys.
 *
 * Rule 4 still holds: an event only invalidates a query key. Payloads are never written into the
 * cache, so a malformed or hostile push cannot corrupt what the app shows.
 */
import { RealtimeEvents } from '@fleet/shared';
import { REALTIME_THROTTLE_MS } from './policy';

export const EVENTS = RealtimeEvents;

/**
 * Event name -> the query key(s) it invalidates. One refetch per key per throttle window, so a
 * map that ticks every second still costs one request.
 */
export function queryKeyForEvent(event: string): string[] | null {
  switch (event) {
    case RealtimeEvents.driverShift:
      return ['shift-active'];
    case RealtimeEvents.driverVehicle:
    case RealtimeEvents.vehicleStates:
      return ['vehicle-states'];
    case RealtimeEvents.driverAccident:
    case RealtimeEvents.accidentLive:
      return ['accidents'];
    case RealtimeEvents.notifications:
      return ['notifications'];
    default:
      return null;
  }
}

/** Every event a driver client can receive (a DRIVER never joins the admin map or the on-call room). */
export const DRIVER_EVENTS: readonly string[] = [
  RealtimeEvents.driverShift,
  RealtimeEvents.driverVehicle,
  RealtimeEvents.driverAccident,
  RealtimeEvents.notifications,
];

/** Every event an admin console client can receive. */
export const ADMIN_EVENTS: readonly string[] = [
  RealtimeEvents.vehicleStates,
  RealtimeEvents.accidentLive,
  RealtimeEvents.notifications,
];

export interface SocketLike {
  on(ev: string, fn: (...a: any[]) => void): unknown;
  emit(ev: string, ...a: any[]): unknown;
  disconnect(): unknown;
}

export interface RealtimeDeps {
  socket: SocketLike;
  /** The events to listen for. */
  events: readonly string[];
  invalidate: (key: string[]) => void;
  setSocketUp: (up: boolean) => void;   // false => screens fall back to REST polling
  /** Every raw event, for things that must react immediately (e.g. a Mayday banner). Payloads are untrusted. */
  onEvent?: (event: string, payload: unknown) => void;
  /** The fleet map can emit every second; refetching on each one would hammer the API. */
  throttleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/**
 * B-05: one refetch per key per REALTIME_THROTTLE_MS; screens poll every POLL_FALLBACK_MS while the socket is
 * down. Both numbers live in core/policy.ts.
 * A reconnect invalidates every key the client listens for, which is exactly the (re)subscribe snapshot.
 */
export function attachRealtime({
  socket,
  events,
  invalidate,
  setSocketUp,
  onEvent,
  throttleMs = REALTIME_THROTTLE_MS,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
}: RealtimeDeps): () => void {
  const last = new Map<string, number>();
  const pending = new Set<string>();
  const fire = (key: string[]) => {
    const k = key.join('|');
    const wait = (last.get(k) ?? 0) + throttleMs - now();
    if (wait <= 0) { last.set(k, now()); invalidate(key); return; }
    if (pending.has(k)) return;   // a trailing refetch is already scheduled and will pick this up
    pending.add(k);
    setTimer(() => { pending.delete(k); last.set(k, now()); invalidate(key); }, wait);
  };

  const keys = [...new Set(events.map(queryKeyForEvent).filter((k): k is string[] => !!k))];
  // `last` starts at 0 so the reconnect snapshot fires immediately, not after a throttle window.
  socket.on('connect', () => { setSocketUp(true); for (const key of keys) fire(key); });
  // A reconnect means the gateway is re-sending current state, so the throttle window is dropped:
  // the refetch that matters must happen now, not up to throttleMs later.
  socket.on('disconnect', () => { last.clear(); setSocketUp(false); });
  socket.on('connect_error', () => setSocketUp(false));

  for (const event of events) {
    const key = queryKeyForEvent(event);
    socket.on(event, (payload: unknown) => { onEvent?.(event, payload); if (key) fire(key); });
  }
  return () => socket.disconnect();
}