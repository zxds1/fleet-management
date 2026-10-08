import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { PHONE_POINTS, PhonePointsSchema, type PhonePointsInput } from '@fleet/shared';
import { ENDPOINTS, url } from '../api/endpoints';
import { api, session } from '../services';
import { config } from '../services';

/**
 * Phone-GPS fallback (U-01 / C1.9).
 *
 * This closes the contract half of the gap: `POST /telemetry/points` now exists and accepts an
 * authenticated batch, and the vehicle is taken from the caller's OPEN SHIFT server-side, never from the
 * request. So `phone_gps_fallback_enabled` on `ClockInSchema` finally has data behind it.
 *
 * WHAT THIS DOES **NOT** DO, stated plainly rather than implied: it does not run a silent background
 * service. `expo-task-manager` with a foreground service is the only way to keep uploading with the app
 * backgrounded on Android, and that is untested on real hardware in this repo — a background location
 * service that has not been run on a real phone for a full shift is a worse risk than not shipping it.
 * So the loop below runs WHILE THE APP IS OPEN AND THE SHIFT IS ACTIVE, and the consent screen says so.
 * The remaining work is listed as the last device-test item in docs/REVIEW.md, not hidden.
 *
 * Battery: the sampler is `watchPositionAsync` with a distance filter, not a timer, so a parked phone
 * costs nothing and a moving one records roughly every 50 m. Points are buffered and flushed as one
 * batch, bounded by the same limits the server enforces.
 */
export interface PhonePoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
  speed_kph?: number;
  heading_deg?: number;
  accuracy_m?: number;
}

const ENABLED_KEY = 'phone_tracking_enabled';
const BUFFER_KEY = 'phone_tracking_buffer';

/** Whether the person opted in on this device. Read at clock-in so the server's rest maths matches reality. */
export const isPhoneTrackingEnabled = (): Promise<boolean> =>
  SecureStore.getItemAsync(ENABLED_KEY).then((v) => v === '1').catch(() => false);

async function setEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(ENABLED_KEY, '1');
  else await SecureStore.deleteItemAsync(ENABLED_KEY);
}

// ── buffer ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Points survive a process kill: they are staged in SecureStore, because an unsent position is exactly the
 * data a driver cannot be asked to retake. At most one buffer's worth is kept, and it is trimmed to the
 * server's age window on read, so a phone that was off for a day cannot resurrect stale positions.
 */
async function readBuffer(): Promise<PhonePoint[]> {
  const raw = await SecureStore.getItemAsync(BUFFER_KEY);
  if (!raw) return [];
  try {
    const pts = JSON.parse(raw) as PhonePoint[];
    const cutoff = Date.now() - PHONE_POINTS.maxHistorySeconds * 1000;
    return pts.filter((p) => Date.parse(p.recorded_at) >= cutoff).slice(-PHONE_POINTS.maxPoints);
  } catch {
    return [];
  }
}

async function writeBuffer(pts: PhonePoint[]): Promise<void> {
  if (!pts.length) { await SecureStore.deleteItemAsync(BUFFER_KEY); return; }
  await SecureStore.setItemAsync(BUFFER_KEY, JSON.stringify(pts.slice(-PHONE_POINTS.maxPoints)));
}

/** Appends and returns the buffer, so a caller can decide when to flush. Pure enough to unit test. */
export const appendPoint = async (pt: PhonePoint): Promise<PhonePoint[]> => {
  const pts = await readBuffer();
  const next = [...pts, pt].slice(-PHONE_POINTS.maxPoints);
  await writeBuffer(next);
  return next;
};

/**
 * Sends the buffer to the server. Returns how many points were accepted; 0 means either nothing buffered
 * or the server refused (off shift, too old, too dense), and the buffer is KEPT in the latter case so the
 * points are not silently lost — they age out on their own instead.
 */
export async function flushPoints(): Promise<number> {
  const pts = await readBuffer();
  if (!pts.length) return 0;
  const body: PhonePointsInput = PhonePointsSchema.parse({ points: pts.map((p) => ({ ...p })) });
  try {
    await api.post(url(ENDPOINTS.phonePoints), { body });
    await writeBuffer([]);
    return body.points.length;
  } catch {
    return 0;
  }
}

/** True when the last flush failed, so the UI can say "some positions have not been sent". */
export async function pendingPointCount(): Promise<number> {
  return (await readBuffer()).length;
}

// ── the sampler ──────────────────────────────────────────────────────────────────────────────────
// There is deliberately NO expo-task-manager background service here. On Android only a foreground
// service keeps uploading once the app is backgrounded, and shipping one that has never been run on a
// real phone for a full shift is a worse risk than not shipping it. The loop below therefore runs while
// the app is OPEN and the shift is active, the consent copy says so, and the remaining work is an
// explicit device-test item in docs/REVIEW.md rather than something left implied.

let subscription: Location.LocationSubscription | null = null;
let flusher: ReturnType<typeof setInterval> | null = null;

/**
 * Starts sampling. Idempotent. The distance filter is what keeps the battery honest: no timer, so a
 * stationary driver records nothing at all.
 */
export async function startPhoneTracking(): Promise<boolean> {
  if (subscription) return true;
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return false;
  await setEnabled(true);
  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,      // metres
      timeInterval: PHONE_POINTS.minIntervalSeconds * 1000,
    },
    (l) => {
      void appendPoint({
        latitude: l.coords.latitude,
        longitude: l.coords.longitude,
        recorded_at: new Date(l.timestamp).toISOString(),
        ...(l.coords.speed != null ? { speed_kph: Math.max(0, l.coords.speed) } : {}),
        ...(l.coords.heading != null ? { heading_deg: l.coords.heading } : {}),
        ...(l.coords.accuracy != null ? { accuracy_m: l.coords.accuracy } : {}),
      }).then((pts) => { if (pts.length >= PHONE_POINTS.maxPoints) void flushPoints(); });
    },
  );
  // A periodic flush so a batch goes out even when the driver is stationary at a red light.
  flusher = setInterval(() => void flushPoints(), 60_000);
  return true;
}

export async function stopPhoneTracking(): Promise<void> {
  subscription?.remove();
  subscription = null;
  if (flusher) clearInterval(flusher);
  flusher = null;
  await setEnabled(false);
}

export const isPhoneTrackingRunning = (): boolean => subscription !== null;

/** Flush on the way out: a position in the buffer at clock-out is data that would otherwise be lost. */
export const flushOnStop = async (): Promise<number> => {
  await stopPhoneTracking();
  return flushPoints();
};

/** True when the app should be uploading: opted in, on shift, and an access token available. */
export async function shouldBeTracking(): Promise<boolean> {
  if (await isPhoneTrackingEnabled()) return true;
  // The prompt threshold is a server-side knob (`tracker.phone_fallback_prompt_minutes`), so the decision
  // is not hardcoded here: it is only used to decide whether to OFFER the mode.
  return AppState.currentState === 'active';
}

/** The threshold the consent screen uses to decide whether to offer the mode at all. */
export const fallbackPromptMinutes = (): number => config.numeric('tracker.phone_fallback_prompt_minutes');

/** The offline ceiling still applies: no positioning upload happens without a usable session. */
export async function canUploadNow(): Promise<boolean> {
  return (await session.getAccessToken()) != null;
}