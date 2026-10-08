import { describe, it, expect, vi } from 'vitest';
import { attachRealtime, queryKeyForEvent, DRIVER_EVENTS, ADMIN_EVENTS } from '../src/core/realtime';
import { RealtimeEvents } from '@fleet/shared';

class FakeSocket {
  handlers = new Map<string, (...a: any[]) => void>(); emitted: any[][] = []; disconnected = false;
  on(ev: string, fn: (...a: any[]) => void) { this.handlers.set(ev, fn); return this; } emit(...a: any[]) { this.emitted.push(a); return this; } disconnect() { this.disconnected = true; }
  fire(ev: string, ...a: any[]) { this.handlers.get(ev)?.(...a); }
}

/** The gateway never accepts a subscription, so the app emits nothing at all. */
function setup(events: string[], throttleMs = 2000) {
  const s = new FakeSocket(); const invalidate = vi.fn(); const up = vi.fn(); const onEvent = vi.fn(); let t = 1_000_000;
  const timers: { fn: () => void; at: number }[] = [];
  const stop = attachRealtime({ socket: s, events, invalidate, setSocketUp: up, onEvent, throttleMs, now: () => t, setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; } });
  const advance = (ms: number) => { t += ms; for (const x of timers.splice(0).filter((x) => x.at <= t)) x.fn(); };
  return { s, invalidate, up, onEvent, stop, advance, timers };
}

describe('event -> query key mapping (events invalidate, never patch)', () => {
  it.each([
    [RealtimeEvents.driverShift, ['shift-active']],
    [RealtimeEvents.driverVehicle, ['vehicle-states']],
    [RealtimeEvents.vehicleStates, ['vehicle-states']],
    [RealtimeEvents.driverAccident, ['accidents']],
    [RealtimeEvents.accidentLive, ['accidents']],
    [RealtimeEvents.notifications, ['notifications']],
    ['something:else', null],
  ])('%s', (ev, key) => expect(queryKeyForEvent(ev)).toEqual(key));
});

describe('the event sets match the gateway rooms (07 §3)', () => {
  it('a driver never listens for the admin map or the on-call room', () => {
    expect(DRIVER_EVENTS).not.toContain(RealtimeEvents.vehicleStates);
    expect(DRIVER_EVENTS).not.toContain(RealtimeEvents.accidentLive);
    expect(DRIVER_EVENTS).toContain(RealtimeEvents.driverVehicle);
  });
  it('an admin listens for the map, the on-call room and notifications', () => {
    expect(ADMIN_EVENTS).toEqual([RealtimeEvents.vehicleStates, RealtimeEvents.accidentLive, RealtimeEvents.notifications]);
  });
});

describe('attachRealtime', () => {
  it('emits nothing: the gateway decides rooms from the token', () => {
    const { s, up } = setup([...DRIVER_EVENTS]); s.fire('connect');
    expect(up).toHaveBeenCalledWith(true);
    expect(s.emitted).toEqual([]);
  });
  it('a reconnect refetches exactly what this client listens for (the gateway re-sends the snapshot)', () => {
    const { s, invalidate } = setup([RealtimeEvents.notifications, RealtimeEvents.driverShift]);
    s.fire('connect'); s.fire('disconnect'); invalidate.mockClear(); s.fire('connect');
    expect(invalidate).toHaveBeenCalledWith(['shift-active']);
    expect(invalidate).toHaveBeenCalledWith(['notifications']);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it('an event invalidates the matching query and reports the raw payload', () => {
    const { s, invalidate, onEvent } = setup([RealtimeEvents.driverVehicle]);
    s.fire(RealtimeEvents.driverVehicle, { display_state: 'MOVING' });
    expect(invalidate).toHaveBeenCalledWith(['vehicle-states']);
    expect(onEvent).toHaveBeenCalledWith(RealtimeEvents.driverVehicle, { display_state: 'MOVING' });
  });
  it('an event never writes into the cache, so a malformed push cannot corrupt what is on screen', () => {
    const { s, invalidate, onEvent } = setup([RealtimeEvents.driverVehicle]);
    s.fire(RealtimeEvents.driverVehicle, { junk: { c: 3 } });
    expect(invalidate).toHaveBeenCalledWith(['vehicle-states']);
    expect(onEvent).toHaveBeenCalled();
  });
  it.each(['disconnect', 'connect_error'])('%s flips the socket to down so screens fall back to REST polling', (ev) => {
    const { s, up } = setup([]); s.fire(ev); expect(up).toHaveBeenCalledWith(false);
  });
  it('an unknown event is reported but never wired to a query', () => {
    const { s, invalidate, onEvent } = setup(['x:y']); s.fire('x:y', 1);
    expect(invalidate).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalled();
  });
  it('the returned cleanup disconnects', () => { const { s, stop } = setup([]); stop(); expect(s.disconnected).toBe(true); });
  it('a burst of map events causes one immediate refetch and one trailing refetch, not one per event', () => {
    const { s, invalidate, advance } = setup([RealtimeEvents.vehicleStates]);
    for (let i = 0; i < 20; i++) s.fire(RealtimeEvents.vehicleStates, { i });
    expect(invalidate).toHaveBeenCalledTimes(1);
    advance(2000);
    expect(invalidate).toHaveBeenCalledTimes(2);
    advance(10_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});