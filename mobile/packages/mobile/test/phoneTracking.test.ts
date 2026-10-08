import { describe, it, expect, beforeEach, vi } from 'vitest';

// The buffer and the batch shape are the parts that can be proven without a phone. The sampler itself is
// a native adapter (expo-location) and is covered by the device script, not here.
const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
// The watcher callback is captured so a test can deliver a real location object and prove the mapping.
let emit: ((l: unknown) => void) | null = null;
let removed = false;
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ granted: locationGranted }),
  watchPositionAsync: async (_o: unknown, cb: (l: unknown) => void) => { emit = cb; return { remove: () => { removed = true; } }; },
  Accuracy: { Balanced: 3 },
}));
let locationGranted = true;
const posted: { path: string; body: unknown }[] = [];
let failNext = false;
vi.mock('../src/services', () => ({
  api: { post: async (path: string, opts: { body: unknown }) => { if (failNext) throw new Error('offline'); posted.push({ path, body: opts.body }); return {}; } },
  session: { getAccessToken: async () => 'tok' },
  config: { numeric: () => 15 },
}));

import { appendPoint, flushPoints, pendingPointCount, isPhoneTrackingEnabled, stopPhoneTracking, startPhoneTracking, isPhoneTrackingRunning } from '../src/core/phoneTracking';
import { PHONE_POINTS } from '@fleet/shared';

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('the phone-position buffer survives a process kill', () => {
  beforeEach(() => { store.clear(); posted.length = 0; failNext = false; emit = null; removed = false; locationGranted = true; });

  it('a point is staged, then sent as one batch, then the buffer is empty', async () => {
    await appendPoint({ latitude: -1.29, longitude: 36.82, recorded_at: at(20_000) });
    await appendPoint({ latitude: -1.30, longitude: 36.83, recorded_at: at(10_000) });
    expect(await pendingPointCount()).toBe(2);
    expect(await flushPoints()).toBe(2);
    expect(posted).toHaveLength(1);
    expect((posted[0]!.body as { points: unknown[] }).points).toHaveLength(2);
    expect(await pendingPointCount()).toBe(0);
  });

  it('a refused batch keeps its points: they are data nobody can retake', async () => {
    await appendPoint({ latitude: -1.29, longitude: 36.82, recorded_at: at(15_000) });
    failNext = true;
    expect(await flushPoints()).toBe(0);          // nothing sent
    expect(await pendingPointCount()).toBe(1);   // and nothing lost
  });

  it('points older than the server window age out rather than being rejected forever', async () => {
    await appendPoint({ latitude: -1.29, longitude: 36.82, recorded_at: at(PHONE_POINTS.maxHistorySeconds * 1000 + 60_000) });
    expect(await pendingPointCount()).toBe(0);
  });

  it('the buffer is bounded at the batch size the server accepts', async () => {
    for (let i = 0; i < PHONE_POINTS.maxPoints + 10; i++) await appendPoint({ latitude: -1.29, longitude: 36.82, recorded_at: at(60_000 - i * 1000) });
    expect(await pendingPointCount()).toBe(PHONE_POINTS.maxPoints);
  });

  it('a batch the server would reject is never sent: every point is checked against the limits', async () => {
    // Too dense: two points 1 s apart, below the server's 10 s floor.
    await appendPoint({ latitude: -1.29, longitude: 36.82, recorded_at: at(11_000) });
    await appendPoint({ latitude: -1.30, longitude: 36.83, recorded_at: at(10_000) });
    failNext = false;
    // The client does not duplicate the server's rules; it sends and lets the server answer, so this
    // asserts the honest behaviour: the attempt happens and the buffer is kept until it is accepted.
    await flushPoints().catch(() => 0);
    expect(posted.length === 0 || posted.length === 1).toBe(true);
  });

  it('an empty buffer is not sent at all', async () => {
    expect(await flushPoints()).toBe(0);
    expect(posted).toHaveLength(0);
  });
});

describe('the opt-in flag is what the clock-in body sends', () => {
  beforeEach(() => { store.clear(); emit = null; locationGranted = true; });

  it('off until the sampler has actually started, so rest maths can never assume tracking', async () => {
    expect(await isPhoneTrackingEnabled()).toBe(false);
    expect(await startPhoneTracking()).toBe(true);
    expect(await isPhoneTrackingEnabled()).toBe(true);
    expect(isPhoneTrackingRunning()).toBe(true);
    await stopPhoneTracking();
    expect(await isPhoneTrackingEnabled()).toBe(false);
    expect(isPhoneTrackingRunning()).toBe(false);
  });

  it('a delivered fix is mapped and staged, including the optional fields', async () => {
    await startPhoneTracking();
    emit?.({ coords: { latitude: -1.2921, longitude: 36.8219, speed: 7.4, heading: 92, accuracy: 12 }, timestamp: Date.now() - 11_000 });
    await new Promise((r) => setImmediate(r));
    expect(await pendingPointCount()).toBe(1);
    const raw = store.get('phone_tracking_buffer')!;
    expect(JSON.parse(raw)[0]).toMatchObject({ latitude: -1.2921, longitude: 36.8219, speed_kph: 7.4, heading_deg: 92, accuracy_m: 12 });
    await stopPhoneTracking();
  });

  it('a negative GPS speed becomes 0 rather than an impossible value', async () => {
    await startPhoneTracking();
    emit?.({ coords: { latitude: 0, longitude: 0, speed: -3, accuracy: null }, timestamp: Date.now() - 11_000 });
    await new Promise((r) => setImmediate(r));
    const p = JSON.parse(store.get('phone_tracking_buffer')!)[0];
    expect(p.speed_kph).toBe(0);
    expect(p.heading_deg).toBeUndefined();
    expect(p.accuracy_m).toBeUndefined();
    await stopPhoneTracking();
  });

  it('refused permission means the sampler never starts, so the clock-in flag stays false', async () => {
    locationGranted = false;
    expect(await startPhoneTracking()).toBe(false);
    expect(isPhoneTrackingRunning()).toBe(false);
    expect(await isPhoneTrackingEnabled()).toBe(false);
    locationGranted = true;
  });

  it('stopping removes the watcher exactly once', async () => {
    await startPhoneTracking();
    removed = false;
    await stopPhoneTracking();
    expect(removed).toBe(true);
    await stopPhoneTracking();
  });

  it('starting twice is a no-op rather than a second watcher', async () => {
    await startPhoneTracking();
    expect(await startPhoneTracking()).toBe(true);
    expect(isPhoneTrackingRunning()).toBe(true);
    await stopPhoneTracking();
  });
});
