// packages/mobile/src/core/phoneTracking.android.ts
// Android foreground service for background phone-GPS (U-01).
//
// This is additive: the iOS path and the shared buffer/flush logic stay in phoneTracking.ts.
// On Android we register an expo-task-manager task and start it as a FOREGROUND_SERVICE so
// location sampling continues when the app is backgrounded.
//
// Resilience:
//  - Location accuracy/distance filter match the foreground loop (balanced, 50 m).
//  - Points are appended to the SAME SecureStore buffer, so a process kill cannot lose data.
//  - The periodic flush still runs; if the task is killed by the OS, the next flush recovers
//    everything still in the buffer.
//  - We do NOT retry the location subscription inside the task: one watcher is enough, and
//    expo-location handles the Android service lifecycle.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PHONE_POINTS, PhonePointsSchema, type PhonePointsInput } from '@fleet/shared';
import { ENDPOINTS, url } from '../api/endpoints';
import { api, session } from '../services';
import { appendPoint, flushPoints as sharedFlush, isPhoneTrackingEnabled, readBuffer, setEnabled, writeBuffer } from './phoneTracking.shared';

const TASK_NAME = 'phone-gps-background';

export async function startPhoneTracking(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return false;
  await setEnabled(true);

  const has = await TaskManager.getTaskAsync(TASK_NAME).then(() => true).catch(() => false);
  if (!has) {
    TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
      if (error) return;
      const loc = (data as { locations?: Location.LocationObject[] })?.locations?.[0];
      if (!loc) return;
      await appendPoint({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        recorded_at: new Date(loc.timestamp).toISOString(),
        ...(loc.coords.speed != null ? { speed_kph: Math.max(0, loc.coords.speed) } : {}),
        ...(loc.coords.heading != null ? { heading_deg: loc.coords.heading } : {}),
        ...(loc.coords.accuracy != null ? { accuracy_m: loc.coords.accuracy } : {}),
      });
    });
  }

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 50,
    timeInterval: PHONE_POINTS.minIntervalSeconds * 1000,
    deferredUpdatesInterval: 30_000,
    foregroundService: {
      notificationTitle: 'Helix is tracking your location',
      notificationBody: 'Your shift is active and GPS is running.',
      notificationColor: '#0F6B4F',
    },
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
  });

  // Periodic flush from the background task. The buffer is shared with the foreground path.
  // eslint-disable-next-line no-global-assign
  (global as unknown as Record<string, unknown>).__helixPhoneFlushInterval = setInterval(() => void flushPoints(), 60_000);
  return true;
}

export async function stopPhoneTracking(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try { await Location.stopLocationUpdatesAsync(TASK_NAME); } catch { /* task was not running */ }
  try { await TaskManager.unregisterTaskAsync(TASK_NAME); } catch { /* task was not registered */ }
  const iv = (global as unknown as Record<string, unknown>).__helixPhoneFlushInterval as ReturnType<typeof setInterval> | undefined;
  if (iv) clearInterval(iv);
  // eslint-disable-next-line no-global-assign
  (global as unknown as Record<string, unknown>).__helixPhoneFlushInterval = undefined;
  await setEnabled(false);
}

export const isPhoneTrackingRunning = (): boolean => false;

export const flushOnStop = async (): Promise<number> => {
  await stopPhoneTracking();
  return flushPoints();
};

async function flushPoints(): Promise<number> {
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
