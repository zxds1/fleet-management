import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { canJoin, createGateway, type Principal } from '../src/gateway';

const drv: Principal = { userId: 'u1', roles: ['DRIVER'] }; const adm: Principal = { userId: 'a1', roles: ['ADMIN'] };
const scope = { shiftIds: ['s1'], vehicleIds: ['v1'] };

describe('ACL', () => {
  it('drivers: only their own shift/vehicle/accident channels and notifications', () => {
    for (const c of ['driver:shift:s1', 'driver:vehicle:v1', 'driver:accident:u1', 'notifications']) expect(canJoin(drv, c, scope), c).toBe(true);
    for (const c of ['driver:shift:s2', 'driver:vehicle:v2', 'driver:accident:u2', 'map:vehicle-states', 'accident:live', 'driver:shift:', 'driver:shift:s1:x', 'x']) expect(canJoin(drv, c, scope), c).toBe(false);
  });
  it('admins: fleet map, live accidents, notifications; never driver-scoped channels', () => {
    for (const c of ['map:vehicle-states', 'accident:live', 'notifications']) expect(canJoin(adm, c, scope)).toBe(true);
    expect(canJoin(adm, 'driver:shift:s1', scope)).toBe(false);
  });
});

describe('gateway over real sockets', () => {
  const open: Socket[] = []; let stop: (() => void) | null = null;
  afterEach(() => { open.splice(0).forEach((s) => s.disconnect()); stop?.(); stop = null; });
  async function boot(max?: number) {
    const http = createServer(); const gw = createGateway(http, {
      verify: async (t) => (t === 'drv' ? drv : t === 'drv2' ? { userId: 'u2', roles: ['DRIVER'] } : t === 'adm' ? adm : null),
      scopeFor: async (u) => (u === 'u1' ? scope : { shiftIds: [], vehicleIds: [] }),
      snapshot: async (_p, ch) => ({ shift: { channels: ch }, vehicle_state: { n: 1 } }), maxSessionsPerUser: max,
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r)); stop = () => { gw.close(); http.close(); };
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const client = (token: string | undefined) => { const s = connect(url, { transports: ['websocket'], auth: token ? { token } : {}, reconnection: false }); open.push(s); return s; };
    return { gw, client };
  }
  const once = <T = any>(s: Socket, ev: string) => new Promise<T>((r) => s.once(ev, r));

  it('rejects bad/missing tokens at the handshake', async () => {
    const { client } = await boot(); const s = client('nope'); const err = await once<Error>(s, 'connect_error'); expect(err.message).toBe('UNAUTHENTICATED');
    expect(await once<Error>(client(undefined), 'connect_error')).toBeTruthy();
  });
  it('subscribe -> snapshot, then events flow only to authorised subscribers', async () => {
    const { gw, client } = await boot(); const a = client('drv'); const b = client('drv2'); await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('subscribe', 'driver:shift:s1'); const snap = await once(a, 'snapshot'); expect(snap.shift.channels).toContain('driver:shift:s1');
    b.emit('subscribe', 'driver:shift:s1'); expect(await once(b, 'subscribe_denied')).toEqual({ channel: 'driver:shift:s1' });
    const got = once(a, 'driver:shift:s1'); let leaked = false; b.on('driver:shift:s1', () => (leaked = true));
    gw.publish('driver:shift:s1', { state: 'CLOSED' }); expect(await got).toEqual({ state: 'CLOSED' }); await new Promise((r) => setTimeout(r, 50)); expect(leaked).toBe(false);
  });
  it('notifications are per-user', async () => {
    const { gw, client } = await boot(); const a = client('drv'); const b = client('drv2'); await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('subscribe', 'notifications'); b.emit('subscribe', 'notifications'); await Promise.all([once(a, 'snapshot'), once(b, 'snapshot')]);
    let bGot = false; b.on('notifications', () => (bGot = true)); const aGot = once(a, 'notifications');
    gw.publish('notifications', { id: 'n1' }, 'u1'); await aGot; await new Promise((r) => setTimeout(r, 50)); expect(bGot).toBe(false);
  });
  it('a reconnect + resubscribe gets a fresh snapshot', async () => {
    const { client } = await boot(); const a = client('drv'); await once(a, 'connect'); a.emit('subscribe', 'driver:vehicle:v1'); await once(a, 'snapshot'); a.disconnect();
    const a2 = client('drv'); await once(a2, 'connect'); a2.emit('subscribe', 'driver:vehicle:v1'); expect((await once(a2, 'snapshot')).vehicle_state).toEqual({ n: 1 });
  });
  it('enforces the session cap: the oldest connection is dropped', async () => {
    const { gw, client } = await boot(2); const s1 = client('drv'); await once(s1, 'connect'); const s2 = client('drv'); await once(s2, 'connect');
    const dropped = once(s1, 'session_replaced'); const s3 = client('drv'); await once(s3, 'connect'); await dropped; expect(gw.sessionCount('u1')).toBe(2);
  });
  it('disconnectUser kicks every session (use on suspend/revoke)', async () => {
    const { gw, client } = await boot(); const a = client('drv'); await once(a, 'connect'); const gone = once(a, 'disconnect'); gw.disconnectUser('u1'); await gone; expect(a.connected).toBe(false);
  });
});
