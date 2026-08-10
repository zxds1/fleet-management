// packages/ws/test/gateway.test.ts
// Unit tests for the gateway connection handler using a fake socket — no live PG/Redis required.
import jwt from "jsonwebtoken";
import type { ConfigClient, Principal, VehicleDisplayStateViewRow } from "@fleet/shared";
import { loadEnv } from "../src/config/env";
import { memoryBundle } from "../src/config/redis";
import { principalFromClaims } from "../src/security/tokens";
import { AccountStatusRepository } from "../src/repositories/identity";
import { MemoryEventBus } from "../src/pubsub";
import {
  attachGateway,
  createState,
  diffVehicleStates,
  handleConnection,
  type GatewayDeps,
  type WsSocket,
} from "../src/gateway";

const env = loadEnv();

class FakeSocket implements WsSocket {
  id = Math.random().toString(36).slice(2);
  handshake: { auth?: Record<string, unknown> } = {};
  data: { principal?: Principal } = {};
  rooms: string[] = [];
  emitted: { event: string; payload: unknown }[] = [];
  disconnectCalled = false;
  private handlers: Record<string, (...args: unknown[]) => void> = {};

  join(room: string): void {
    this.rooms.push(room);
  }
  leave(room: string): void {
    this.rooms = this.rooms.filter((r) => r !== room);
  }
  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
  }
  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers[event] = handler;
  }
  disconnect(_close?: boolean): void {
    this.disconnectCalled = true;
  }
  trigger(event: string, ...args: unknown[]): void {
    this.handlers[event]?.(...args);
  }
}

function tokenFor(sessionId: string, sub = "u1"): string {
  return jwt.sign(
    { sub, email: "a@b.c", roles: ["ADMIN"], permissions: ["shift:read"], sid: sessionId, locale: "en", tid: "00000000-0000-0000-0000-000000000001" },
    env.JWT_SECRET,
    { algorithm: "HS256", issuer: env.JWT_ISSUER, keyid: env.JWT_KID },
  );
}

function driverTokenFor(sessionId: string, sub = "u-driver"): string {
  return jwt.sign(
    { sub, email: "d@b.c", roles: ["DRIVER"], permissions: ["shift:clock_in"], sid: sessionId, locale: "en" },
    env.JWT_SECRET,
    { algorithm: "HS256", issuer: env.JWT_ISSUER, keyid: env.JWT_KID },
  );
}

function baseDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  const config = { numeric: async (_k: string, fb = 10) => fb } as unknown as ConfigClient;
  const accountStatus = {
    check: async () => "ok",
    revokeSession: async () => undefined,
    listActiveSessionIds: async () => [],
  } as unknown as AccountStatusRepository;
  return {
    env,
    verifyToken: (t) => principalFromClaims(jwt.verify(t, env.JWT_SECRET) as never),
    store: memoryBundle().sessions,
    config,
    accountStatus,
    vehicleSnapshot: async () => [],
    notificationsFor: async () => [],
    isAccidentOnCall: async () => false,
    driverScope: async () => null,
    driverVehicleState: async () => null,
    driverShiftState: async () => null,
    bus: new MemoryEventBus(),
    ...overrides,
  };
}

describe("gateway authentication", () => {
  it("disconnects a connection with no token", async () => {
    const socket = new FakeSocket();
    await handleConnection(socket, baseDeps(), createState());
    expect(socket.disconnectCalled).toBe(true);
    expect(socket.rooms).toHaveLength(0);
  });

  it("disconnects a connection with an invalid token", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: "garbage" } };
    await handleConnection(socket, baseDeps(), createState());
    expect(socket.disconnectCalled).toBe(true);
  });

  it("disconnects a suspended account with the ACCOUNT_SUSPENDED code path", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: tokenFor("s1") } };
    const deps = baseDeps({
      accountStatus: {
        check: async () => "ACCOUNT_SUSPENDED",
        revokeSession: async () => undefined,
        listActiveSessionIds: async () => [],
      } as unknown as AccountStatusRepository,
    });
    await handleConnection(socket, deps, createState());
    expect(socket.disconnectCalled).toBe(true);
    expect(socket.rooms).toHaveLength(0);
  });
});

describe("gateway connection setup", () => {
  it("subscribes to channels and sends a snapshot on connect", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: tokenFor("s1") } };
    await handleConnection(socket, baseDeps(), createState());

    expect(socket.disconnectCalled).toBe(false);
    expect(socket.rooms).toContain("map:vehicle-states");
    expect(socket.rooms).toContain("notifications:u1");

    const events = socket.emitted.map((e) => e.event);
    expect(events).toContain("map:vehicle-states");
    expect(events).toContain("notifications");
  });

  it("adds the socket to the accident:live room when on call", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: tokenFor("s1") } };
    const deps = baseDeps({ isAccidentOnCall: async () => true });
    await handleConnection(socket, deps, createState());
    expect(socket.rooms).toContain("accident:live");
  });
});

describe("gateway 10-session cap (A1.6 / 02 §6)", () => {
  it("evicts the oldest session when an 11th connects, disconnecting it", async () => {
    const deps = baseDeps();
    const state = createState();
    const sockets: FakeSocket[] = [];

    for (let i = 0; i < 11; i++) {
      const sid = `s${i}`;
      const socket = new FakeSocket();
      socket.handshake = { auth: { token: tokenFor(sid) } };
      sockets.push(socket);
      await handleConnection(socket, deps, state);
    }

    // Only the first (oldest) socket should have been force-disconnected by the cap.
    expect(sockets[0]!.disconnectCalled).toBe(true);
    for (let i = 1; i < 11; i++) expect(sockets[i]!.disconnectCalled).toBe(false);
    expect(state.sockets.has("s10")).toBe(true);
    expect(state.sockets.has("s0")).toBe(false);
  });
});

describe("vehicle state diff (07 §5 backpressure)", () => {
  it("returns all rows on first push and only changed rows after", () => {
    const a = { vehicle_id: "v1", display_state: "MOVING" } as VehicleDisplayStateViewRow;
    const b = { vehicle_id: "v2", display_state: "PARKED" } as VehicleDisplayStateViewRow;
    const prev = new Map<string, VehicleDisplayStateViewRow>();
    expect(diffVehicleStates(prev, [a, b])).toHaveLength(2);

    const cache = new Map<string, VehicleDisplayStateViewRow>([
      ["v1", a],
      ["v2", b],
    ]);
    const next = [
      { vehicle_id: "v1", display_state: "MOVING" } as VehicleDisplayStateViewRow,
      { vehicle_id: "v2", display_state: "IDLING" } as VehicleDisplayStateViewRow,
    ];
    const changed = diffVehicleStates(cache, next);
    expect(changed).toHaveLength(1);
    expect((changed[0] as { vehicle_id: string }).vehicle_id).toBe("v2");
  });
});

describe("gateway driver channels (07 §3/§5)", () => {
  const scope = { driverId: "d1", vehicleId: "v1" };
  const vehicleRow = { vehicle_id: "v1", display_state: "MOVING" } as VehicleDisplayStateViewRow;
  const shiftRow = { shift_id: "sh1", state: "OPEN", vehicle_id: "v1" } as never;

  function driverDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
    return baseDeps({
      driverScope: async () => scope,
      driverVehicleState: async () => vehicleRow,
      driverShiftState: async () => shiftRow,
      ...overrides,
    });
  }

  it("joins the driver's own room and never the admin map room", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    await handleConnection(socket, driverDeps(), createState());

    expect(socket.disconnectCalled).toBe(false);
    expect(socket.rooms).toContain("driver:d1");
    expect(socket.rooms).toContain("notifications:u-driver");
    expect(socket.rooms).not.toContain("map:vehicle-states");
    expect(socket.rooms).not.toContain("accident:live");
  });

  it("snapshots the driver's own vehicle + shift state on (re)connect", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    await handleConnection(socket, driverDeps(), createState());

    const events = socket.emitted.map((e) => e.event);
    expect(events).toContain("driver:vehicle");
    expect(events).toContain("driver:shift");
    expect(events).toContain("notifications");
    expect(socket.emitted.find((e) => e.event === "driver:vehicle")?.payload).toEqual(vehicleRow);
  });

  it("records the driver→vehicle scope so bus events can be routed", async () => {
    const state = createState();
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    await handleConnection(socket, driverDeps(), state);
    expect(state.driverVehicles.get("d1")).toBe("v1");
  });

  it("connects a driver with no assignment without emitting a vehicle snapshot", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    const deps = driverDeps({ driverScope: async () => ({ driverId: "d2", vehicleId: null }) });
    await handleConnection(socket, deps, createState());

    expect(socket.disconnectCalled).toBe(false);
    expect(socket.rooms).toContain("driver:d2");
    expect(socket.emitted.map((e) => e.event)).not.toContain("driver:vehicle");
  });

  it("fans driver shift + accident bus events out to that driver's room only", async () => {
    const bus = new MemoryEventBus();
    const deps = driverDeps({ bus });
    const emits: { room: string; event: string; payload: unknown }[] = [];
    const fakeIo = {
      use: (_fn: unknown) => undefined,
      on: (_e: string, _fn: (s: WsSocket) => void) => undefined,
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => emits.push({ room, event, payload }),
      }),
      emit: (_e: string, _p: unknown) => undefined,
    };
    attachGateway(fakeIo as never, deps, createState());

    await bus.publish("ws:driver:shift", { driverId: "d1", state: "CLOSED" });
    await bus.publish("ws:driver:accident", { driverId: "d1", accident_id: "a1" });
    await bus.publish("ws:driver:shift", { state: "CLOSED" }); // unscoped → dropped

    expect(emits).toEqual([
      { room: "driver:d1", event: "driver:shift", payload: { driverId: "d1", state: "CLOSED" } },
      { room: "driver:d1", event: "driver:accident", payload: { driverId: "d1", accident_id: "a1" } },
    ]);
  });

  it("pushes a changed vehicle row to the owning driver's room as well as the admin map", async () => {
    const bus = new MemoryEventBus();
    const state = createState();
    state.driverVehicles.set("d1", "v1");
    const deps = driverDeps({ bus, vehicleSnapshot: async () => [vehicleRow] });
    const emits: { room: string; event: string }[] = [];
    const fakeIo = {
      use: (_fn: unknown) => undefined,
      on: (_e: string, _fn: (s: WsSocket) => void) => undefined,
      to: (room: string) => ({ emit: (event: string, _p: unknown) => emits.push({ room, event }) }),
      emit: (_e: string, _p: unknown) => undefined,
    };
    attachGateway(fakeIo as never, deps, state);

    await bus.publish("ws:map:vehicle-states", {});
    await new Promise((r) => setImmediate(r));

    expect(emits).toContainEqual({ room: "map:vehicle-states", event: "map:vehicle-states" });
    expect(emits).toContainEqual({ room: "driver:d1", event: "driver:vehicle" });
  });
});

/**
 * REGRESSION (mobile contract): the driver realtime channel payload *shapes*.
 *
 * `packages/mobile/src/core/driver/feed.ts` consumes these emits directly, so the wire shape is a
 * contract: notifications must arrive as an ARRAY (both the (re)connect snapshot and the live
 * fan-out `[notification]`), and the driver's own vehicle snapshot must be the raw
 * `app.v_vehicle_display_state` row — `license_plate`, PG numerics as strings, nullable GPS.
 */
describe("gateway driver payload shapes (mobile feed.ts contract)", () => {
  const driverScope = { driverId: "d1", vehicleId: "v1" };

  /** Realistic `app.v_vehicle_display_state` row: null GPS fix, numeric columns as strings. */
  const unfixedVehicleRow = {
    vehicle_id: "v1",
    license_plate: "KDA 123A",
    vehicle_class: "TRUCK",
    asset_status: "ACTIVE",
    is_operational: true,
    shift_id: "sh1",
    driver_id: "d1",
    driver_name: "Peter Mwangi",
    last_position: null,
    latitude: null,
    longitude: null,
    last_position_at: "2026-08-09T06:00:00.000Z",
    last_speed_kph: "0.00",
    last_ignition: false,
    is_online: true,
    next_eligible_clock_in_at: null,
    limit_reached_at: null,
    warning_sent_at: null,
    display_state: "PARKED",
  } as unknown as VehicleDisplayStateViewRow;

  const notificationRow = {
    id: "n1",
    title: "Shift closed",
    body: "Your shift was closed by dispatch",
    status: "QUEUED",
    priority: "HIGH",
    queued_at: "2026-08-09T17:05:00.000Z",
  } as never;

  it("joins the driver room and emits the own-vehicle snapshot as the raw view row", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    const deps = baseDeps({
      driverScope: async () => driverScope,
      driverVehicleState: async () => unfixedVehicleRow,
      notificationsFor: async () => [notificationRow],
    });
    await handleConnection(socket, deps, createState());

    expect(socket.rooms).toContain("driver:d1");

    const vehicleEmit = socket.emitted.find((e) => e.event === "driver:vehicle");
    expect(vehicleEmit).toBeDefined();
    const payload = vehicleEmit!.payload as Record<string, unknown>;
    // The mobile VehicleStateSchema relies on exactly these keys/shapes.
    expect(payload["license_plate"]).toBe("KDA 123A");
    expect(payload["latitude"]).toBeNull();
    expect(payload["longitude"]).toBeNull();
    expect(typeof payload["last_speed_kph"]).toBe("string");
    expect(payload["display_state"]).toBe("PARKED");
  });

  it("emits the driver notifications (re)connect snapshot as an ARRAY", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    const deps = baseDeps({
      driverScope: async () => driverScope,
      driverVehicleState: async () => unfixedVehicleRow,
      notificationsFor: async () => [notificationRow],
    });
    await handleConnection(socket, deps, createState());

    const notifEmit = socket.emitted.find((e) => e.event === "notifications");
    expect(notifEmit).toBeDefined();
    expect(Array.isArray(notifEmit!.payload)).toBe(true);
    expect(notifEmit!.payload).toHaveLength(1);
  });

  it("emits an empty ARRAY (not null/undefined) when the driver has no notifications", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: driverTokenFor("s1") } };
    const deps = baseDeps({ driverScope: async () => driverScope, notificationsFor: async () => [] });
    await handleConnection(socket, deps, createState());

    const notifEmit = socket.emitted.find((e) => e.event === "notifications");
    expect(Array.isArray(notifEmit!.payload)).toBe(true);
    expect(notifEmit!.payload).toHaveLength(0);
  });

  it("fans a live notification out to the user room wrapped in an ARRAY", async () => {
    const bus = new MemoryEventBus();
    const deps = baseDeps({ bus });
    const emits: { room: string; event: string; payload: unknown }[] = [];
    const fakeIo = {
      use: (_fn: unknown) => undefined,
      on: (_e: string, _fn: (s: WsSocket) => void) => undefined,
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => emits.push({ room, event, payload }),
      }),
      emit: (_e: string, _p: unknown) => undefined,
    };
    attachGateway(fakeIo as never, deps, createState());

    await bus.publish("ws:notifications", { userId: "u-driver", notification: notificationRow });
    await new Promise((r) => setImmediate(r));

    expect(emits).toHaveLength(1);
    expect(emits[0]!.room).toBe("notifications:u-driver");
    expect(emits[0]!.event).toBe("notifications");
    expect(Array.isArray(emits[0]!.payload)).toBe(true);
    expect(emits[0]!.payload).toEqual([notificationRow]);
  });

  it("emits the admin map snapshot as a BARE ARRAY (what core/admin.ts parses)", async () => {
    const socket = new FakeSocket();
    socket.handshake = { auth: { token: tokenFor("s1") } };
    const deps = baseDeps({ vehicleSnapshot: async () => [unfixedVehicleRow] });
    await handleConnection(socket, deps, createState());

    const mapEmit = socket.emitted.find((e) => e.event === "map:vehicle-states");
    expect(mapEmit).toBeDefined();
    expect(Array.isArray(mapEmit!.payload)).toBe(true);
    expect(mapEmit!.payload).toEqual([unfixedVehicleRow]);
  });
});

describe("attachGateway wiring", () => {
  it("rejects a connection in the auth middleware via next(Error)", async () => {
    const deps = baseDeps();
    const middlewareCalls: { err?: Error }[] = [];
    const fakeIo = {
      use: async (fn: (s: WsSocket, next: (e?: Error) => void) => void) => {
        const socket = new FakeSocket();
        await fn(socket, (e?: Error) => middlewareCalls.push({ err: e }));
      },
      on: (_e: string, _fn: (s: WsSocket) => void) => undefined,
      emit: (_e: string, _p: unknown) => undefined,
    };
    attachGateway(fakeIo as never, deps);
    await new Promise((r) => setImmediate(r)); // flush the async middleware
    // No token → middleware must reject with an error whose message is the error_code.
    expect(middlewareCalls).toHaveLength(1);
    expect(middlewareCalls[0]!.err).toBeInstanceOf(Error);
    expect(middlewareCalls[0]!.err?.message).toBe("UNAUTHENTICATED");
  });
});
