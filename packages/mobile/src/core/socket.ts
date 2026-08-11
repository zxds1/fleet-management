// packages/mobile/src/core/socket.ts
//
// Real-time client (D-3, 07). Pure logic over an injected Socket.IO factory so it is unit-testable
// in node with a fake socket. Responsibilities:
//   • Connect with the bearer token (the gateway rejects without one, 07 §1).
//   • Driver subscribes to `driver:shift` / `driver:vehicle` / `driver:accident`; admin subscribes to
//     `map:vehicle-states` / `notifications` / `accident:live` (server-decides rooms, 07 §3).
//   • Snapshot on (re)connect is pushed as the first emit of each event — handlers just receive rows.
//   • Token refresh: when the session token rotates, call `setToken` so the next reconnect auths.
//
// Handlers are keyed by the `ws:`-prefixed `RealtimeChannel` (the shared contract callers use) while
// the socket listens on the unprefixed `RealtimeEvents` names the gateway actually emits;
// `EVENT_FOR_CHANNEL` bridges the two.
//
// No secrets are logged (C5.3) — we never log the token, only connection lifecycle + channel names.

import { EVENT_FOR_CHANNEL, RealtimeChannels, type RealtimeChannel } from "@fleet/shared/mobile";

export type DriverChannel =
  | typeof RealtimeChannels.driverShift
  | typeof RealtimeChannels.driverVehicle
  | typeof RealtimeChannels.driverAccident;

export type AdminChannel =
  | typeof RealtimeChannels.vehicleStates
  | typeof RealtimeChannels.notifications
  | typeof RealtimeChannels.accidentLive;

/** Structural Socket.IO surface we depend on — lets us fake it in tests. */
export interface SocketLike {
  connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  io?: { opts?: { auth?: Record<string, unknown> } };
}

export interface SocketFactory {
  (
    url: string,
    opts: {
      auth: { token: string };
      transports?: string[];
      /** Live token accessor: the factory re-reads it on every reconnect attempt so a rotated
       * access token is used for the next handshake (07 §1). */
      getToken?: () => string | undefined;
    },
  ): SocketLike;
}

export type SocketStatus = "connecting" | "connected" | "disconnected" | "error";

export interface SocketClientDeps {
  url: string;
  /** Returns the current bearer token; re-read on every (re)connect. */
  getToken: () => string | undefined;
  /** Injected Socket.IO factory. Omitted only where there is no real-time backend (demo mode). */
  factory?: SocketFactory;
  /** Notified on lifecycle changes (used to flip the offline banner + retry queue). */
  onStatus?: (status: SocketStatus) => void;
  /** Notified on auth rejection so the session layer can force re-login (B13). */
  onAuthFailure?: (code: string) => void;
}

type Handler = (payload: unknown) => void;
type StatusListener = (status: SocketStatus) => void;

export class SocketClient {
  private socket: SocketLike | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly statusListeners = new Set<StatusListener>();
  private currentStatus: SocketStatus = "disconnected";
  // Driver events the client explicitly listens to (server still gates by principal).
  private readonly driverChannels: DriverChannel[] = [
    RealtimeChannels.driverShift,
    RealtimeChannels.driverVehicle,
    RealtimeChannels.driverAccident,
  ];
  private readonly adminChannels: AdminChannel[] = [
    RealtimeChannels.vehicleStates,
    RealtimeChannels.notifications,
    RealtimeChannels.accidentLive,
  ];
  private role: "driver" | "admin" | null = null;

  constructor(private readonly deps: SocketClientDeps) {}

  connect(role: "driver" | "admin") {
    this.role = role;
    const token = this.deps.getToken();
    if (!token) {
      this.setStatus("error");
      return;
    }
    // No real-time backend (e.g. demo mode / web without a socket factory): skip connect
    // gracefully so the app stays usable. Screens render with their offline/empty state.
    if (typeof this.deps.factory !== "function") {
      this.setStatus("disconnected");
      return;
    }
    const socket = this.deps.factory(this.deps.url, {
      auth: { token },
      transports: ["websocket"],
      getToken: this.deps.getToken,
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.setStatus("connected");
      this.resubscribe();
    });
    socket.on("disconnect", () => this.setStatus("disconnected"));
    socket.on("connect_error", (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "";
      // The gateway middleware rejects with the error_code string (07 §1).
      if (msg === "UNAUTHENTICATED" || msg === "ACCOUNT_SUSPENDED" || msg === "DEVICE_REVOKED") {
        this.deps.onAuthFailure?.(msg);
      }
      this.setStatus("error");
    });

    // Route every subscribed channel's server emits to local handlers. The gateway emits the
    // unprefixed event name, while handlers are registered under the shared channel constant.
    for (const ch of [...this.driverChannels, ...this.adminChannels]) {
      socket.on(EVENT_FOR_CHANNEL[ch], (payload: unknown) => this.dispatch(ch, payload));
    }

    this.setStatus("connecting");
    socket.connect();
  }

  /** Re-emit subscriptions after a reconnect (rooms are server-joined, but we re-bind handlers). */
  private resubscribe() {
    if (!this.socket) return;
    const channels = this.role === "driver" ? this.driverChannels : this.adminChannels;
    for (const ch of channels) this.socket.emit("subscribe", EVENT_FOR_CHANNEL[ch]);
  }

  private dispatch(channel: string, payload: unknown) {
    const set = this.handlers.get(channel);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch {
        /* a bad handler must not break the socket */
      }
    }
  }

  /** Register a listener for a realtime channel. Returns an unsubscribe fn. */
  on(channel: RealtimeChannel, handler: Handler): () => void {
    const set = this.handlers.get(channel) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Subscribe to connection-lifecycle changes so the UI can flip its offline banner. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: SocketStatus): void {
    this.currentStatus = status;
    this.deps.onStatus?.(status);
    for (const l of [...this.statusListeners]) {
      try {
        l(status);
      } catch {
        /* a bad listener must not break the socket */
      }
    }
  }

  /** Update the auth token for the next (re)connect without tearing down handlers. */
  setToken(token: string | undefined) {
    if (this.socket?.io) this.socket.io.opts = { ...(this.socket.io.opts ?? {}), auth: { token: token ?? "" } };
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus("disconnected");
  }

  get status(): SocketStatus {
    if (!this.socket) return "disconnected";
    if (this.socket.connected) return "connected";
    // `currentStatus` distinguishes a failed handshake from an in-flight one.
    return this.currentStatus === "error" ? "error" : "connecting";
  }
}
