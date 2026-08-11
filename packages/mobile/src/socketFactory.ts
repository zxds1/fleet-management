// packages/mobile/src/socketFactory.ts
//
// The ONLY module that imports `socket.io-client`. `SocketClient` stays pure over the injected
// `SocketFactory` so it remains unit-testable in node; the composition root (`services.ts`) supplies
// this implementation when a real-time backend is configured.
//
// The gateway authenticates from `handshake.auth.token` (07 §1), so the access token travels there
// rather than in a header — `SocketClient.setToken` rewrites `io.opts.auth` before every reconnect.

import { io, type Socket } from "socket.io-client"
import type { SocketFactory, SocketLike } from "./core/socket"

/** Default gateway origin; `deploy/docker-compose.yml` publishes the ws service on 4001. */
export const DEFAULT_WS_URL = "ws://localhost:4001"

export function resolveWsUrl(explicit?: string, apiBaseUrl?: string): string {
  if (explicit) return explicit
  if (apiBaseUrl) {
    // The API base carries the `/api/v1` prefix; the gateway is mounted at the origin root.
    try {
      const url = new URL(apiBaseUrl)
      return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`
    } catch {
      /* not an absolute URL — fall through to the default */
    }
  }
  return DEFAULT_WS_URL
}

/**
 * Builds the real Socket.IO client. `autoConnect` is disabled because `SocketClient` registers its
 * handlers first and then calls `connect()` explicitly, so no emit can be missed.
 */
export const socketIoFactory: SocketFactory = (url, opts) => {
  const socket: Socket = io(url, {
    auth: opts.auth,
    transports: opts.transports ?? ["websocket"],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  })
  // The manager caches `auth` from construction, so re-read the live token before each retry:
  // a token rotated by the session layer must be the one the gateway verifies (07 §1).
  const getToken = opts.getToken
  if (getToken) {
    socket.io.on("reconnect_attempt", () => {
      socket.auth = { token: getToken() ?? "" }
    })
  }
  return socket as unknown as SocketLike
}
