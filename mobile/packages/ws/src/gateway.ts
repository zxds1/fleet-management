import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

/**
 * Reference implementation of the driver/admin channel layer the mobile app expects.
 * It is transport + ACL only: plug your JWT verifier, scope lookup and snapshot source into the hooks below,
 * and call `publish()` from wherever domain events are emitted (Redis subscriber, outbox relay, ...).
 */
export interface Principal { userId: string; roles: string[] }
export interface DriverScope { shiftIds: string[]; vehicleIds: string[] }
export interface GatewayHooks {
  /** Verify the access token from the handshake. Return null for invalid/expired/revoked. */
  verify(token: string): Promise<Principal | null>;
  /** What a driver may see right now (active shift/vehicle). Called on every subscribe, so it is always current. */
  scopeFor(userId: string): Promise<DriverScope>;
  /** Current state for the channels the client joined; sent as `snapshot` after every subscribe/reconnect. */
  snapshot(p: Principal, channels: string[]): Promise<Record<string, unknown>>;
  maxSessionsPerUser?: number;     // default 10
}

const ADMIN_ROLES = new Set(['ADMIN', 'FLEET_MANAGER']);
export const isAdmin = (p: Principal) => p.roles.some((r) => ADMIN_ROLES.has(r));

/** The ACL. Pure so it can be tested exhaustively. Anything not explicitly allowed is refused. */
export function canJoin(p: Principal, channel: string, scope: DriverScope): boolean {
  if (channel === 'notifications') return true;                       // the room is per-user (see roomFor), never shared
  if (isAdmin(p)) return channel === 'map:vehicle-states' || channel === 'accident:live';
  let m: RegExpExecArray | null;
  if ((m = /^driver:shift:([^:]+)$/.exec(channel))) return scope.shiftIds.includes(m[1]!);
  if ((m = /^driver:vehicle:([^:]+)$/.exec(channel))) return scope.vehicleIds.includes(m[1]!);
  if ((m = /^driver:accident:([^:]+)$/.exec(channel))) return m[1] === p.userId;
  return false;
}
/** `notifications` is user-scoped: map it to a per-user room so one user's alerts never reach another. */
export const roomFor = (p: Principal, channel: string) => (channel === 'notifications' ? `notifications:${p.userId}` : channel);

export function createGateway(httpServer: HttpServer | number, hooks: GatewayHooks, opts: { path?: string } = {}) {
  const io = new Server(httpServer as never, { path: opts.path, transports: ['websocket'], cors: { origin: false } });
  const cap = hooks.maxSessionsPerUser ?? 10;
  const sessions = new Map<string, Socket[]>();       // oldest first
  const principals = new WeakMap<Socket, Principal>();
  const joined = new WeakMap<Socket, Set<string>>();

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    const p = token ? await hooks.verify(token).catch(() => null) : null;
    if (!p) return next(new Error('UNAUTHENTICATED'));
    principals.set(socket, p); joined.set(socket, new Set()); next();
  });

  io.on('connection', (socket) => {
    const p = principals.get(socket)!;
    const list = sessions.get(p.userId) ?? []; list.push(socket); sessions.set(p.userId, list);
    while (list.length > cap) { const oldest = list.shift()!; oldest.emit('session_replaced'); oldest.disconnect(true); }   // 10-session cap: newest wins
    socket.on('disconnect', () => { const l = sessions.get(p.userId); if (l) { const i = l.indexOf(socket); if (i >= 0) l.splice(i, 1); if (!l.length) sessions.delete(p.userId); } });

    socket.on('subscribe', async (channel: unknown) => {
      if (typeof channel !== 'string' || channel.length > 100) return;
      const scope = isAdmin(p) ? { shiftIds: [], vehicleIds: [] } : await hooks.scopeFor(p.userId);
      if (!canJoin(p, channel, scope)) { socket.emit('subscribe_denied', { channel }); return; }
      await socket.join(roomFor(p, channel)); joined.get(socket)!.add(channel);
      socket.emit('snapshot', await hooks.snapshot(p, [...joined.get(socket)!]));      // fresh state after every (re)subscribe
    });
  });

  return {
    io,
    /** Domain event -> every subscribed client. Payload is a hint; the app refetches over REST. */
    publish(channel: string, payload: unknown, userId?: string) { io.to(channel === 'notifications' && userId ? `notifications:${userId}` : channel).emit(channel, payload); },
    /** Call on suspend / session revoke / device revoke. */
    disconnectUser(userId: string) { for (const s of sessions.get(userId) ?? []) s.disconnect(true); },
    sessionCount: (userId: string) => sessions.get(userId)?.length ?? 0,
    close: () => io.close(),
  };
}
