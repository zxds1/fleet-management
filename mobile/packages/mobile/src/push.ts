import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Notification } from '@fleet/shared';
import { parseDeepLink, type Target } from './core/deepLinks';
import { ROLE_KEY } from './state/roles';

/**
 * Notifications WITHOUT Firebase.
 *
 * There is no FCM token, no `google-services.json`, and no `expo-notifications` remote-push call anywhere
 * in this app (see `app.config.ts`). The delivery path is the realtime gateway the app ALREADY holds open:
 * `packages/ws/src/gateway.ts` publishes every new notification to `notifications:{userId}`, and the
 * producers (`packages/worker/src/outbox/relay.ts`, `jobs/stale-shift.ts`) publish to that same topic. So
 * a notification arriving on the `notifications` event is turned into a LOCAL notification by
 * `expo-notifications`, which uses Android's own NotificationManager and needs no push service at all.
 *
 * What this costs, stated plainly (ledger T-08 / P-06):
 *  • A notification is delivered while the app process is alive and the socket is connected. That covers the
 *    case that actually matters here — the admin console and a driver's phone on shift — because the console
 *    is foregrounded and the driver is holding the app.
 *  • If Android has killed the process, there is NO background delivery, because reliable background push on
 *    Android without FCM or an OEM channel (Huawei/Xiaomi) is not achievable. The inbox itself is the durable
 *    record: the gateway re-sends the unread snapshot on every connect, so a driver who reopens the app sees
 *    exactly what they missed, and nothing is lost — it is only late.
 *  • Re-adding FCM later is two things: `googleServicesFile` in `app.config.ts` and a token passed to
 *    `POST /auth/devices` (whose `push_token` field already exists and is already persisted server-side).
 *    Nothing else in this file would need to change.
 *
 * Android 13+ needs the OS POST_NOTIFICATIONS grant for ANY notification, local or remote; that is an OS
 * permission, not a Firebase one.
 */
const SHOWN_KEY = 'notified_ids';

const notificationsInUse = () =>
  Platform.OS === 'android' && Device.osName === 'Android' && Device.isDevice;

let handlerReady: Promise<void> | null = null;

/** Configure how a local notification is presented. Idempotent. */
export function initLocalNotifications(): Promise<void> {
  if (handlerReady) return handlerReady;
  handlerReady = (async () => {
    if (!notificationsInUse()) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    const cur = await Notifications.getPermissionsAsync();
    // Android 13 requires an explicit grant even for a locally scheduled notification.
    if (cur.status !== 'granted') await Notifications.requestPermissionsAsync();
    await SecureStore.setItemAsync('local_notifications', '1');
  })();
  return handlerReady;
}

async function shownIds(): Promise<Set<string>> {
  const raw = await SecureStore.getItemAsync(SHOWN_KEY);
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

/**
 * Remembers which notifications have already been surfaced. The gateway re-sends the whole unread
 * snapshot on every connect, so without this a reconnect would re-notify about everything, which is
 * exactly the kind of noise that makes people turn notifications off.
 */
async function remember(ids: string[]): Promise<void> {
  const set = await shownIds();
  const before = set.size;
  for (const id of ids) set.add(id);
  if (set.size === before) return;
  // Bounded: only the most recent 200 ids are kept.
  await SecureStore.setItemAsync(SHOWN_KEY, JSON.stringify([...set].slice(-200)));
}

/**
 * S-04 resolved. The only non-empty payload any producer writes is `{ shift_id }` (the stale-shift job);
 * every other notification has `payload = {}` because its INSERT omits the column. So a tap can open
 * exactly one thing, and anything else falls through to the inbox rather than a guessed route.
 */
export function targetFromNotification(payload: unknown, role: 'DRIVER' | 'ADMIN'): Target | null {
  const shiftId = payload && typeof payload === 'object' ? (payload as { shift_id?: unknown }).shift_id : undefined;
  return typeof shiftId === 'string' && shiftId.length > 0 ? parseDeepLink(`helix://shift/${shiftId}`, role) : null;
}

/** Presenting is best-effort: a failed local notification must never break the socket handler. */
export async function presentNotification(n: Notification, role: 'DRIVER' | 'ADMIN'): Promise<boolean> {
  try {
    await initLocalNotifications();
    if (!notificationsInUse()) return false;
    const seen = await shownIds();
    if (seen.has(n.id)) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: n.title,
        body: n.body,
        data: n.payload && typeof n.payload === 'object' ? (n.payload as Record<string, unknown>) : {},
      },
      trigger: null,   // immediately
    });
    await remember([n.id]);
    return true;
  } catch {
    return false;   // no notification permission, or the channel could not be opened
  }
}

/**
 * Subscribes to taps. `data` is the producer's payload, which is untrusted, so the only key read is
 * `shift_id` and the id must be a valid path segment before anything is navigated to.
 */
export function onNotificationTap(open: (t: Target) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    const role = useRole();
    const t = targetFromNotification(res.notification.request.content.data, role);
    if (t) open(t);
  });
  return () => sub.remove();
}

/** Small indirection so this module does not import the store (which imports services, which imports this). */
let roleReader: () => 'DRIVER' | 'ADMIN' = () => 'DRIVER';
export const setRoleReader = (fn: () => 'DRIVER' | 'ADMIN'): void => { roleReader = fn; };
const useRole = (): 'DRIVER' | 'ADMIN' => roleReader();

/** Removes the local-notification grant marker on sign-out, but never the delivered ids. */
export const clearNotificationGrant = async (): Promise<void> => {
  await SecureStore.deleteItemAsync('local_notifications');
};

export { ROLE_KEY };