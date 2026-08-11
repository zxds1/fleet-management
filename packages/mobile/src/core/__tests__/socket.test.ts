// packages/mobile/src/core/__tests__/socket.test.ts
import { SocketClient, type SocketLike, type SocketFactory } from "../socket";
import { EVENT_FOR_CHANNEL, RealtimeChannels, RealtimeEvents } from "@fleet/shared/mobile";

function fakeSocket(): SocketLike & { fire(event: string, ...args: unknown[]): void; handlers: Map<string, Set<(...a: unknown[]) => void>> } {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const socket: SocketLike & { fire(event: string, ...args: unknown[]): void; handlers: Map<string, Set<(...a: unknown[]) => void>> } = {
    connected: false,
    io: { opts: { auth: {} } },
    connect() {
      this.connected = true;
      queueMicrotask(() => handlers.get("connect")?.forEach((h) => h()));
    },
    disconnect() {
      this.connected = false;
      handlers.get("disconnect")?.forEach((h) => h());
    },
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
    },
    off(event, handler) {
      if (!handler) handlers.delete(event);
      else handlers.get(event)?.delete(handler);
    },
    emit(event, ...args) {
      // server-side "subscribe" ack is a no-op in the fake
      void event;
      void args;
    },
    fire(event, ...args) {
      handlers.get(event)?.forEach((h) => h(...args));
    },
    handlers,
  };
  return socket;
}

function makeFactory() {
  let last: ReturnType<typeof fakeSocket> | null = null;
  const factory: SocketFactory = (_url, _opts) => {
    last = fakeSocket();
    return last;
  };
  return { factory, getLast: () => last! };
}

describe("SocketClient", () => {
  it("connects and dispatches driver channel events to handlers", async () => {
    const { factory, getLast } = makeFactory();
    const received: unknown[] = [];
    const client = new SocketClient({ url: "wss://x", getToken: () => "tok", factory });
    client.connect("driver");
    const unsub = client.on(RealtimeChannels.driverVehicle, (p) => received.push(p));

    const sock = getLast();
    sock.fire("connect");
    // The gateway emits the unprefixed wire event; handlers register on the `ws:` channel.
    sock.fire(RealtimeEvents.driverVehicle, { vehicle_id: "v1" });

    expect(client.status).toBe("connected");
    expect(received).toEqual([{ vehicle_id: "v1" }]);
    unsub();
  });

  it("listens on the gateway's unprefixed event names, not the ws: bus topics", () => {
    const { factory, getLast } = makeFactory();
    const client = new SocketClient({ url: "wss://x", getToken: () => "tok", factory });
    client.connect("driver");
    const listened = [...getLast().handlers.keys()];
    for (const channel of Object.values(RealtimeChannels)) {
      expect(listened).toContain(EVENT_FOR_CHANNEL[channel]);
      expect(listened).not.toContain(channel);
    }
  });

  it("reports auth failure and routes to onAuthFailure", async () => {
    const { factory, getLast } = makeFactory();
    const failures: string[] = [];
    const client = new SocketClient({
      url: "wss://x",
      getToken: () => "tok",
      factory,
      onAuthFailure: (c) => failures.push(c),
    });
    client.connect("admin");
    getLast().fire("connect_error", { message: "DEVICE_REVOKED" });
    expect(failures).toContain("DEVICE_REVOKED");
  });

  it("does not connect without a token", () => {
    const { factory } = makeFactory();
    const statuses: string[] = [];
    const client = new SocketClient({ url: "wss://x", getToken: () => undefined, factory, onStatus: (s) => statuses.push(s) });
    client.connect("driver");
    expect(statuses).toContain("error");
    expect(client.status).toBe("disconnected");
  });

  it("notifies onStatusChange subscribers across the connection lifecycle", () => {
    const { factory, getLast } = makeFactory();
    const seen: string[] = [];
    const client = new SocketClient({ url: "wss://x", getToken: () => "tok", factory });
    const off = client.onStatusChange((s) => seen.push(s));
    client.connect("driver");
    getLast().fire("connect");
    getLast().fire("disconnect");
    expect(seen).toEqual(["connecting", "connected", "disconnected"]);
    off();
    client.disconnect();
    expect(seen).toHaveLength(3);
  });

  it("passes the live token getter to the factory so reconnects can refresh auth", () => {
    let captured: (() => string | undefined) | undefined;
    let token = "first";
    const factory: SocketFactory = (_url, opts) => {
      captured = opts.getToken;
      return fakeSocket();
    };
    const client = new SocketClient({ url: "wss://x", getToken: () => token, factory });
    client.connect("driver");
    expect(captured?.()).toBe("first");
    token = "rotated";
    expect(captured?.()).toBe("rotated");
  });

  it("degrades gracefully with no factory (demo mode) instead of throwing", () => {
    const statuses: string[] = [];
    const client = new SocketClient({ url: "wss://x", getToken: () => "tok", onStatus: (s) => statuses.push(s) });
    client.connect("driver");
    expect(statuses).toEqual(["disconnected"]);
    expect(client.status).toBe("disconnected");
  });
});
