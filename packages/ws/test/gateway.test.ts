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
    { sub, email: "a@b.c", roles: ["ADMIN"], permissions: ["shift:read"], sid: sessionId, locale: "en" },
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
