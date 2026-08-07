// packages/ws/src/gateway.ts
// Socket.IO gateway (07-websocket-gateway.md). Admin-only real-time surface; it holds no system of
// record and recomputes every payload from PG + Redis (07 §1/§3). Connection requires a valid access
// token; the 10-session cap is Redis-enforced with app.user_sessions as the audit source (02 §6,
// R-109); snapshots on (re)connect prevent stale UI (07 §5).
//
// The connection handler is dependency-injected and deliberately free of Socket.IO types so it can
// be unit-tested with a fake socket (test/gateway.test.ts).

import type { ConfigClient, NotificationRow, Principal, VehicleDisplayStateViewRow } from "@fleet/shared";
import type { Env } from "./config/env";
import type { SessionStore } from "./config/redis";
import type { AccountStatus, AccountStatusRepository } from "./repositories/identity";
import type { EventBus } from "./pubsub";
import { Channels } from "./pubsub";

/** Subset of Socket.IO's `Socket` the gateway touches — enables a fake in tests. */
export interface WsSocket {
  id: string;
  handshake: { auth?: Record<string, unknown> };
  data: { principal?: Principal };
  join(room: string): void;
  leave(room: string): void;
  emit(event: string, payload: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  disconnect(close?: boolean): void;
}

export interface GatewayDeps {
  env: Env;
  /** Verifies the access token and returns the Principal; throws on failure. */
  verifyToken(token: string): Principal;
  store: SessionStore;
  config: ConfigClient;
  accountStatus: AccountStatusRepository;
  vehicleSnapshot(): Promise<VehicleDisplayStateViewRow[]>;
  notificationsFor(userId: string): Promise<NotificationRow[]>;
  isAccidentOnCall(userId: string): Promise<boolean>;
  bus: EventBus;
}

export interface GatewayState {
  /** sessionId → live socket, for cap-eviction disconnects. */
  sockets: Map<string, WsSocket>;
  /** vehicle_id → last pushed display-state row (backpressure diff, 07 §5). */
  vehicleCache: Map<string, VehicleDisplayStateViewRow>;
}

export function createState(): GatewayState {
  return { sockets: new Map(), vehicleCache: new Map() };
}

const EVENT_VEHICLES = "map:vehicle-states";
const ROOM_VEHICLES = EVENT_VEHICLES;
const EVENT_NOTIFICATIONS = "notifications";
const roomNotifications = (userId: string) => `notifications:${userId}`;
const EVENT_ACCIDENT = "accident:live";
const ROOM_ACCIDENT = EVENT_ACCIDENT;

/**
 * Verifies the token + account status. Returns the Principal on success, or an `error_code` string
 * (08 §1 catalogue) when the connection must be rejected. The caller maps that to a disconnect.
 */
export async function authenticateConnection(socket: WsSocket, deps: GatewayDeps): Promise<Principal | string> {
  const token =
    (socket.handshake.auth?.["token"] as string | undefined) ??
    (socket.handshake.auth?.["access_token"] as string | undefined);
  if (!token || typeof token !== "string") return "UNAUTHENTICATED";

  let principal: Principal;
  try {
    principal = deps.verifyToken(token);
  } catch {
    return "UNAUTHENTICATED";
  }

  const status: AccountStatus = await deps.accountStatus.check(principal.userId, {
    sessionId: principal.sessionId,
    deviceIdHash: principal.deviceIdHash,
  });
  if (status !== "ok") return status; // ACCOUNT_SUSPENDED | DEVICE_REVOKED | SESSION_REVOKED

  return principal;
}

function tokenExpiry(principal: Principal, env: Env): Date {
  const exp = (principal as Principal & { exp?: number }).exp;
  if (exp) return new Date(exp * 1000);
  return new Date(Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1000);
}

/**
 * Handles one connection: auth + status, the 10-session cap (evicting the oldest), channel
 * subscription, and the (re)connect snapshot. Throws nothing — failures disconnect the socket.
 */
export async function handleConnection(socket: WsSocket, deps: GatewayDeps, state: GatewayState): Promise<void> {
  const auth = await authenticateConnection(socket, deps);
  if (typeof auth === "string") {
    socket.disconnect(true);
    return;
  }
  const principal = auth;
  socket.data.principal = principal;
  const { userId, sessionId } = principal;

  // --- 10-session cap (A1.6 / 02 §6), Redis-primary with DB fallback (R-109) ---
  const max = await deps.config.numeric("auth.max_concurrent_sessions", 10);
  if (sessionId) {
    const expiresAt = tokenExpiry(principal, deps.env);
    let evicted: string[] = [];
    if (deps.store.available) {
      evicted = await deps.store.add(userId, sessionId, expiresAt, max);
    } else {
      const active = await deps.accountStatus.listActiveSessionIds(userId);
      const overflow = active.length - max;
      if (overflow > 0) evicted = active.slice(0, overflow).filter((id) => id !== sessionId);
    }
    for (const evictedId of evicted) {
      await deps.accountStatus.revokeSession(userId, evictedId, "SESSION_LIMIT_EXCEEDED").catch(() => undefined);
      await deps.store.remove(userId, evictedId).catch(() => undefined);
      state.sockets.get(evictedId)?.disconnect(true); // security alert: oldest session booted
      state.sockets.delete(evictedId);
    }
    state.sockets.set(sessionId, socket);
  }

  // --- Channel subscriptions (server-decided from the Principal, 07 §3/§5) ---
  socket.join(ROOM_VEHICLES); // all authed admins
  socket.join(roomNotifications(userId));
  if (await deps.isAccidentOnCall(userId).catch(() => false)) socket.join(ROOM_ACCIDENT);

  // --- Snapshot on (re)connect so the client never shows stale state (07 §5) ---
  const snapshot = await deps.vehicleSnapshot().catch(() => []);
  for (const row of snapshot) if (row.vehicle_id) state.vehicleCache.set(row.vehicle_id, row);
  socket.emit(EVENT_VEHICLES, snapshot);
  const notifications = await deps.notificationsFor(userId).catch(() => []);
  socket.emit(EVENT_NOTIFICATIONS, notifications);

  socket.on("disconnect", () => {
    if (sessionId) {
      state.sockets.delete(sessionId);
      void deps.store.remove(userId, sessionId).catch(() => undefined);
    }
  });
}

interface MinimalIo {
  use: (fn: (socket: WsSocket, next: (err?: Error) => void) => void) => void;
  on: (event: string, fn: (socket: WsSocket) => void) => void;
  to?: (room: string) => { emit: (event: string, payload: unknown) => void };
  emit: (event: string, payload: unknown) => void;
}

/** Wires Socket.IO `io` to the gateway: auth middleware + connection handler + live bus fan-out. */
export function attachGateway(io: MinimalIo, deps: GatewayDeps, state: GatewayState = createState()): () => void {
  io.use(async (socket, next) => {
    const auth = await authenticateConnection(socket, deps);
    if (typeof auth === "string") return next(new Error(auth));
    socket.data.principal = auth;
    next();
  });

  io.on("connection", (socket) => {
    void handleConnection(socket, deps, state);
  });

  const offVehicles = subscribeBus(deps.bus, Channels.vehicleStates, async () => {
    const snapshot = await deps.vehicleSnapshot().catch(() => []);
    const changed = diffVehicleStates(state.vehicleCache, snapshot);
    for (const row of snapshot) if (row.vehicle_id) state.vehicleCache.set(row.vehicle_id, row);
    if (changed.length > 0) emitTo(io, ROOM_VEHICLES, EVENT_VEHICLES, changed);
  });

  const offNotifications = subscribeBus(deps.bus, Channels.notifications, async (payload) => {
    const { userId, notification } = (payload ?? {}) as { userId?: string; notification?: NotificationRow };
    if (!userId) return;
    emitTo(io, roomNotifications(userId), EVENT_NOTIFICATIONS, notification ? [notification] : []);
  });

  const offAccident = subscribeBus(deps.bus, Channels.accidentLive, async (payload) => {
    emitTo(io, ROOM_ACCIDENT, EVENT_ACCIDENT, payload);
  });

  return () => {
    offVehicles();
    offNotifications();
    offAccident();
  };
}

function subscribeBus(bus: EventBus, channel: string, handler: (payload: unknown) => void): () => void {
  void bus.subscribe(channel, handler);
  return () => {
    /* the bus itself is closed by the caller (index.ts) */
  };
}

function emitTo(io: MinimalIo, room: string, event: string, payload: unknown): void {
  io.to?.(room)?.emit(event, payload);
}

/**
 * Computes the changed vehicle rows between the last pushed snapshot and the new one (07 §5).
 * Returns every row on first push (cache empty).
 */
export function diffVehicleStates(
  prev: Map<string, VehicleDisplayStateViewRow>,
  next: VehicleDisplayStateViewRow[],
): VehicleDisplayStateViewRow[] {
  const changed: VehicleDisplayStateViewRow[] = [];
  for (const row of next) {
    if (!row.vehicle_id) {
      changed.push(row); // un-keyed row always considered changed
      continue;
    }
    const before = prev.get(row.vehicle_id);
    if (!before || JSON.stringify(before) !== JSON.stringify(row)) changed.push(row);
  }
  return changed;
}
