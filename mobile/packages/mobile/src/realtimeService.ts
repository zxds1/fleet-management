import { io, type Socket } from 'socket.io-client';
import { WS_URL } from './config';
import { ADMIN_EVENTS, DRIVER_EVENTS, attachRealtime } from './core/realtime';
import { alertFromEvent } from './core/liveAlerts';
import { ensureAccessToken, queryClient } from './services';
import { useUi } from './state/store';
import type { Role } from './state/roles';
import { RealtimeEvents } from '@fleet/shared';
import { initLocalNotifications, presentNotification, setRoleReader } from './push';

let socket: Socket | null = null;
let stop: (() => void) | null = null;
let current = '';

/**
 * One socket per role. The gateway picks the rooms from the token, so the app only chooses which
 * event names to LISTEN for: a driver can never receive `map:vehicle-states` (admin map) or
 * `accident:live` (on-call room), because the gateway never joins it to those rooms.
 *
 * `auth` runs on every reconnect attempt and always hands the gateway a fresh access token, so a
 * reconnect after an access-token expiry is not rejected.
 */
export function syncRealtime(role: Role | null) {
  if (!role) return stopRealtime();
  const events = role === 'ADMIN' ? ADMIN_EVENTS : DRIVER_EVENTS;
  const key = role;
  if (key === current) return;
  stopRealtime();
  current = key;
  socket = io(WS_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelayMax: 15_000,
    auth: (cb) => { void ensureAccessToken().then((token) => cb(token ? { token } : {})); },
  });
  const ui = useUi.getState();
  stop = attachRealtime({
    socket,
    events,
    invalidate: (k) => void queryClient.invalidateQueries({ queryKey: k }),
    setSocketUp: ui.setSocketUp,
    onEvent: (event, payload) => {
      const a = alertFromEvent(event, payload);
      if (a) useUi.getState().setLiveAlert(a);
      // The custom (non-Firebase) delivery path: a gateway notification event becomes a LOCAL notification.
      if (event === RealtimeEvents.notifications) void onGatewayNotifications(payload, key);
    },
  });
}

/**
 * The gateway sends either a single notification (from the producers, via Redis) or the whole unread
 * array (on connect, as the snapshot). Both shapes are accepted, and `presentNotification` dedupes by id,
 * so a reconnect does not re-notify about everything.
 *
 * The payload is untrusted, so each entry must look like a notification before it is scheduled.
 */
async function onGatewayNotifications(payload: unknown, role: Role): Promise<void> {
  await initLocalNotifications();
  const rows = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && 'notification' in payload ? [(payload as { notification: unknown }).notification] : []);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const n = row as { id?: unknown; title?: unknown; body?: unknown };
    if (typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.body !== 'string') continue;
    await presentNotification({ ...(row as object), id: n.id, title: n.title, body: n.body } as never, role);
  }
}

/** Wires push.ts's role reader to the store, once, without creating an import cycle. */
export function initPushRoleReader(): void {
  setRoleReader(() => useUi.getState().activeRole ?? 'DRIVER');
}

export function stopRealtime(): void {
  stop?.();
  socket = null;
  stop = null;
  current = '';
  useUi.getState().setSocketUp(false);
}