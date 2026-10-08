import * as SecureStore from 'expo-secure-store';
import { PHONE_POINTS, type PhonePoint } from '@fleet/shared';

const ENABLED_KEY = 'phone_tracking_enabled';
const BUFFER_KEY = 'phone_tracking_buffer';

export const isPhoneTrackingEnabled = (): Promise<boolean> =>
  SecureStore.getItemAsync(ENABLED_KEY).then((v) => v === '1').catch(() => false);

export async function setEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(ENABLED_KEY, '1');
  else await SecureStore.deleteItemAsync(ENABLED_KEY);
}

export async function readBuffer(): Promise<PhonePoint[]> {
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

export async function writeBuffer(pts: PhonePoint[]): Promise<void> {
  if (!pts.length) { await SecureStore.deleteItemAsync(BUFFER_KEY); return; }
  await SecureStore.setItemAsync(BUFFER_KEY, JSON.stringify(pts.slice(-PHONE_POINTS.maxPoints)));
}

export async function appendPoint(pt: PhonePoint): Promise<PhonePoint[]> {
  const pts = await readBuffer();
  const next = [...pts, pt].slice(-PHONE_POINTS.maxPoints);
  await writeBuffer(next);
  return next;
}

export async function flushPoints(): Promise<number> {
  const pts = await readBuffer();
  if (!pts.length) return 0;
  // The caller must provide api + session; this file is platform-agnostic.
  return 0;
}
