// packages/ws/src/gateway.ts
// Socket.IO gateway (07-websocket-gateway.md). Admin-only real-time surface; it holds no system of
// record and recomputes every payload from PG + Redis (07 §1/§3). Connection requires a valid access
// token; the 10-session cap is Redis-enforced with app.user_sessions as the audit source (02 §6,
// R-109); snapshots on (re)connect prevent stale UI (07 §5).
//
// The connection handler is dependency-injected and deliberately free of Socket.IO types so it can
// be unit-tested with a fake socket (test/gateway.test.ts).

import type { ConfigClient, NotificationRow, Principal, VehicleDisplayStateViewRow } from "@fleet/shared";
import { RealtimeEvents } from "@fleet/shared";
import type { Env } from "./config/env";
import type { SessionStore } from "./config/redis";
import type { AccountStatus, AccountStatusRepository } from "./repositories/identity";
import type { DriverScope, DriverShiftState } from "./repositories/views";
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
  /** Resolves the driver behind a user + the vehicle their real-time is scoped to (07 §3). */
  driverScope(userId: string): Promise<DriverScope | null>;
  /** The driver's own vehicle display-state row, from the same view the admin map uses. */
  driverVehicleState(vehicleId: string): Promise<VehicleDisplayStateViewRow | null>;
  /** The driver's live shift/HOS state — the `driver:shift` (re)connect snapshot. */
  driverShiftState(driverId: string): Promise<DriverShiftState | null>;
  bus: EventBus;
}

export interface GatewayState {
  /** sessionId → live socket, for cap-eviction disconnects. */
  sockets: Map<string, WsSocket>;
  /** vehicle_id → last pushed display-state row (backpressure diff, 07 §5). */
  vehicleCache: Map<string, VehicleDisplayStateViewRow>;
  /** driver_id → the vehicle currently scoped to that driver, for bus fan-out routing. */
  driverVehicles: Map<string, string>;
}

export function createState(): GatewayState {
  return { sockets: new Map(), vehicleCache: new Map(), driverVehicles: new Map() };
}

const EVENT_VEHICLES = RealtimeEvents.vehicleStates;
const ROOM_VEHICLES = EVENT_VEHICLES;
const EVENT_NOTIFICATIONS = RealtimeEvents.notifications;
const roomNotifications = (userId: string) => `notifications:${userId}`;
const EVENT_ACCIDENT = RealtimeEvents.accidentLive;
const ROOM_ACCIDENT = EVENT_ACCIDENT;

const EVENT_DRIVER_SHIFT = RealtimeEvents.driverShift;
const EVENT_DRIVER_VEHICLE = RealtimeEvents.driverVehicle;
const EVENT_DRIVER_ACCIDENT = RealtimeEvents.driverAccident;
/** One room per driver — every driver-scoped event fans out here (07 §3). */
export const roomDriver = (driverId: string) => `driver:${driverId}`;

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
  // A DRIVER gets only their own scope; anyone else is an admin-console client.
  const isDriver = principal.roles.includes("DRIVER" as Principal["roles"][number]);

  if (isDriver) {
    const scope = await deps.driverScope(userId).catch(() => null);
    if (scope) {
      socket.join(roomDriver(scope.driverId));
      if (scope.vehicleId) state.driverVehicles.set(scope.driverId, scope.vehicleId);
    }
    socket.join(roomNotifications(userId));

    // Snapshot on (re)connect so the driver never shows stale state (07 §5).
    if (scope?.vehicleId) {
      const vehicle = await deps.driverVehicleState(scope.vehicleId).catch(() => null);
      if (vehicle) socket.emit(EVENT_DRIVER_VEHICLE, vehicle);
    }
    if (scope) {
      const shift = await deps.driverShiftState(scope.driverId).catch(() => null);
      if (shift) socket.emit(EVENT_DRIVER_SHIFT, shift);
    }
    const driverNotifications = await deps.notificationsFor(userId).catch(() => []);
    socket.emit(EVENT_NOTIFICATIONS, driverNotifications);

    socket.on("disconnect", () => {
      if (sessionId) {
        state.sockets.delete(sessionId);
        void deps.store.remove(userId, sessionId).catch(() => undefined);
      }
    });
    return;
  }

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
    // Fan the same rows out to each driver whose own vehicle changed (07 §3).
    for (const row of changed) {
      if (!row.vehicle_id) continue;
      for (const driverId of driversForVehicle(state, row.vehicle_id)) {
        emitTo(io, roomDriver(driverId), EVENT_DRIVER_VEHICLE, row);
      }
    }
  });

  const offNotifications = subscribeBus(deps.bus, Channels.notifications, async (payload) => {
    const { userId, notification } = (payload ?? {}) as { userId?: string; notification?: NotificationRow };
    if (!userId) return;
    emitTo(io, roomNotifications(userId), EVENT_NOTIFICATIONS, notification ? [notification] : []);
  });

  const offAccident = subscribeBus(deps.bus, Channels.accidentLive, async (payload) => {
    emitTo(io, ROOM_ACCIDENT, EVENT_ACCIDENT, payload);
  });

  // --- Driver-scoped fan-out. Producers publish with a `driverId` so one subscription per topic
  // routes to the right driver room; `driverVehicle` also accepts a `vehicleId` scope. ---
  const offDriverShift = subscribeBus(deps.bus, Channels.driverShift, async (payload) => {
    const driverId = scopeDriverId(payload);
    if (!driverId) return;
    emitTo(io, roomDriver(driverId), EVENT_DRIVER_SHIFT, payload);
  });

  const offDriverVehicle = subscribeBus(deps.bus, Channels.driverVehicle, async (payload) => {
    const scope = (payload ?? {}) as { driverId?: string; vehicleId?: string };
    const targets = scope.driverId
      ? [scope.driverId]
      : scope.vehicleId
        ? driversForVehicle(state, scope.vehicleId)
        : [];
    for (const driverId of targets) {
      const vehicleId = scope.vehicleId ?? state.driverVehicles.get(driverId);
      const row = vehicleId ? await deps.driverVehicleState(vehicleId).catch(() => null) : null;
      emitTo(io, roomDriver(driverId), EVENT_DRIVER_VEHICLE, row ?? payload);
    }
  });

  const offDriverAccident = subscribeBus(deps.bus, Channels.driverAccident, async (payload) => {
    const driverId = scopeDriverId(payload);
    if (!driverId) return;
    emitTo(io, roomDriver(driverId), EVENT_DRIVER_ACCIDENT, payload);
  });

  return () => {
    offVehicles();
    offNotifications();
    offAccident();
    offDriverShift();
    offDriverVehicle();
    offDriverAccident();
  };
}

/** Drivers currently scoped to a vehicle (a vehicle may be handed between drivers). */
function driversForVehicle(state: GatewayState, vehicleId: string): string[] {
  const out: string[] = [];
  for (const [driverId, scoped] of state.driverVehicles) if (scoped === vehicleId) out.push(driverId);
  return out;
}

function scopeDriverId(payload: unknown): string | undefined {
  const driverId = (payload as { driverId?: unknown })?.driverId;
  return typeof driverId === "string" && driverId.length > 0 ? driverId : undefined;
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
