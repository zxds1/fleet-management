// packages/mobile/src/core/__tests__/feed.test.ts
import { FeedService } from "../driver/feed"
import { SocketClient } from "../socket"
import { RealtimeEvents } from "@fleet/shared/mobile"
import { makeApi, type FakeNetwork } from "./testkit"
import type { SocketFactory, SocketLike } from "../socket"

// Minimal fake Socket.IO that records `on` handlers so the test can emit channel payloads.
function fakeSocketFactory(): { factory: SocketFactory; handlers: Record<string, (...a: unknown[]) => void> } {
  const handlers: Record<string, (...a: unknown[]) => void> = {}
  const socket: SocketLike = {
    connected: true,
    connect() {},
    disconnect() {},
    on(event, handler) {
      handlers[event] = handler as (...a: unknown[]) => void
    },
    off() {},
    emit() {},
    io: { opts: {} },
  }
  const factory: SocketFactory = () => socket
  return { factory, handlers }
}

const A1 = "00000000-0000-4000-8000-0000000000e1"
const A2 = "00000000-0000-4000-8000-0000000000e2"
const V1 = "00000000-0000-4000-8000-0000000000f1"

describe("FeedService", () => {
  it("loads the anomaly feed from the REST page", async () => {
    const n: FakeNetwork = {
      calls: [],
      onRequest: (method, url) => {
        if (url.endsWith("/anomalies")) {
          return {
            status: 200,
            json: {
              data: [
                { id: A1, domain: "FUEL", severity: "HIGH", title: "Gauge mismatch", body: "", created_at: "2026-01-01T10:00:00.000Z" },
                { id: A2, domain: "HOS", severity: "MEDIUM", title: "Rest due", body: "", created_at: "2026-01-01T11:00:00.000Z" },
              ],
              next_cursor: null,
              has_more: false,
            },
          }
        }
        return { status: 200 }
      },
    }
    const api = makeApi(n)
    const svc = new FeedService(api, new SocketClient({ url: "w", getToken: () => "t", factory: fakeSocketFactory().factory }))
    const res = await svc.loadAnomalies()
    expect(res.hasMore).toBe(false)
    expect(svc.anomalies).toHaveLength(2)
    expect(svc.anomalies[0]!.domain).toBe("FUEL")
  })

  it("prepends a notification pushed over the socket and tracks unread", () => {
    const { factory, handlers } = fakeSocketFactory()
    const socket = new SocketClient({ url: "w", getToken: () => "t", factory })
    socket.connect("driver")
    const svc = new FeedService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), socket)
    svc.bindSocket()
    handlers[RealtimeEvents.notifications]?.({
      userId: "u",
      notification: { id: A1, kind: "GENERIC", title: "Shift closed", body: "", created_at: "2026-01-01T10:00:00.000Z", read: false },
    })
    expect(svc.notifications).toHaveLength(1)
    expect(svc.unreadCount).toBe(1)
    svc.markRead(A1)
    expect(svc.unreadCount).toBe(0)
  })

  it("updates own-vehicle state from the driver:vehicle channel", () => {
    const { factory, handlers } = fakeSocketFactory()
    const socket = new SocketClient({ url: "w", getToken: () => "t", factory })
    socket.connect("driver")
    const svc = new FeedService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), socket)
    svc.bindSocket()
    handlers[RealtimeEvents.driverVehicle]?.({
      vehicle_id: V1,
      display_state: "MOVING",
      latitude: -1.2,
      longitude: 36.8,
    })
    expect(svc.vehicle?.display_state).toBe("MOVING")
    expect(svc.vehicle?.vehicle_id).toBe(V1)
  })

  it("snapshots own-vehicle state from the REST map endpoint", async () => {
    const n: FakeNetwork = {
      calls: [],
      onRequest: (method, url) => {
        if (url.endsWith("/dashboard/vehicle-states")) {
          return {
            status: 200,
            json: {
              vehicles: [
                { vehicle_id: V1, display_state: "PARKED", driver_name: null },
                { vehicle_id: "00000000-0000-4000-8000-0000000000f2", display_state: "MOVING" },
              ],
            },
          }
        }
        return { status: 200 }
      },
    }
    const svc = new FeedService(makeApi(n), new SocketClient({ url: "w", getToken: () => "t", factory: fakeSocketFactory().factory }))
    await svc.loadVehicleState(V1)
    expect(svc.vehicle?.display_state).toBe("PARKED")
  })
})
