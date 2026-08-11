// packages/mobile/src/core/__tests__/driverFeed.regression.test.ts
//
// REGRESSION SUITE — driver realtime feed (notifications + own-vehicle state).
//
// Realistic payloads only. The driver channel is fed straight from the gateway:
//   • `socket.emit(EVENT_NOTIFICATIONS, driverNotifications)` — an ARRAY on (re)connect, and the
//     live bus fan-out emits `[notification]` (packages/ws/src/gateway.ts).
//   • `socket.emit(EVENT_DRIVER_VEHICLE, vehicle)` where `vehicle` is the raw
//     `app.v_vehicle_display_state` row: plate under `license_plate`, PG numerics as STRINGS, and
//     `latitude`/`longitude` NULL when the tracker has no GPS fix.

import { FeedService, NotificationSchema, VehicleStateSchema } from "../driver/feed"
import { SocketClient, type SocketFactory, type SocketLike } from "../socket"
import { RealtimeEvents } from "@fleet/shared/mobile"
import { makeApi, uid } from "./testkit"

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
  return { factory: () => socket, handlers }
}

function driverFeed(): { svc: FeedService; handlers: Record<string, (...a: unknown[]) => void> } {
  const { factory, handlers } = fakeSocketFactory()
  const socket = new SocketClient({ url: "wss://ws.fleet.internal", getToken: () => "tok", factory })
  socket.connect("driver")
  const svc = new FeedService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), socket)
  svc.bindSocket()
  return { svc, handlers }
}

const N1 = uid(801)
const N2 = uid(802)
const VEHICLE = uid(901)

/** Driver notification row as the gateway fans it out. */
function driverNotification(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: "SHIFT",
    title: "Shift closed",
    body: "Your shift was closed by dispatch",
    created_at: "2026-08-09T17:05:00.000Z",
    read: false,
    ...over,
  }
}

describe("REGRESSION driver notifications — the gateway emits an ARRAY", () => {
  it("(a) ARRAY form: the (re)connect snapshot lands in the notifications list", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.notifications]?.([
      driverNotification(N1),
      driverNotification(N2, { kind: "DOCUMENT", title: "Licence expiring" }),
    ])

    expect(svc.notifications).toHaveLength(2)
    expect(svc.notifications.map((n) => n.id).sort()).toEqual([N1, N2].sort())
    expect(svc.unreadCount).toBe(2)
  })

  it("(a2) live fan-out emits a single-element array `[notification]`", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.notifications]?.([driverNotification(N1)])

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.title).toBe("Shift closed")
  })

  it("(b) BARE OBJECT row still parses", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.notifications]?.(driverNotification(N1))

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.id).toBe(N1)
  })

  it("(c) { userId, notification } envelope still parses", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.notifications]?.({ userId: uid(803), notification: driverNotification(N1) })

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.id).toBe(N1)
  })

  it("an empty snapshot array is a safe no-op", () => {
    const { svc, handlers } = driverFeed()

    expect(() => handlers[RealtimeEvents.notifications]?.([])).not.toThrow()
    expect(svc.notifications).toHaveLength(0)
  })

  it("NotificationSchema defaults `kind`/`body`/`read` when the row omits them", () => {
    const parsed = NotificationSchema.parse({
      id: N1,
      title: "Rest break due",
      created_at: "2026-08-09T17:05:00.000Z",
    })
    expect(parsed.kind).toBe("GENERIC")
    expect(parsed.body).toBe("")
    expect(parsed.read).toBe(false)
  })
})

describe("REGRESSION driver own-vehicle state — raw v_vehicle_display_state row", () => {
  /**
   * Exactly what `deps.driverVehicleState(vehicleId)` returns and the gateway emits verbatim:
   * `license_plate` (not `plate`), string numerics, nullable GPS.
   */
  function driverVehicleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      vehicle_id: VEHICLE,
      license_plate: "KDA 123A",
      vehicle_class: "TRUCK",
      asset_status: "ACTIVE",
      is_operational: true,
      shift_id: uid(902),
      driver_id: uid(903),
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
      fuel_level_pct: "62.50",
      def_level_pct: "40.00",
      odometer_km: "12345",
      engine_hours: "4821.5",
      battery_volts: "12.80",
      estimated_range_km: "310",
      ...over,
    }
  }

  it("parses null GPS + string numerics and maps license_plate → plate", () => {
    const parsed = VehicleStateSchema.parse(driverVehicleRow())

    expect(parsed.vehicle_id).toBe(VEHICLE)
    expect(parsed.display_state).toBe("PARKED")
    expect(parsed.latitude).toBeNull()
    expect(parsed.longitude).toBeNull()
    // String numerics must coerce to real numbers, not stay strings and not become NaN.
    expect(parsed.fuel_level_pct).toBe(62.5)
    expect(parsed.odometer_km).toBe(12345)
    expect(parsed.engine_hours).toBe(4821.5)
    expect(parsed.battery_volts).toBe(12.8)
    expect(parsed.license_plate).toBe("KDA 123A")
  })

  it("FeedService exposes the plate under `plate` even though the row names it license_plate", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.driverVehicle]?.(driverVehicleRow())

    expect(svc.vehicle).not.toBeNull()
    expect(svc.vehicle?.plate).toBe("KDA 123A")
    expect(svc.vehicle?.fuel_level_pct).toBe(62.5)
    expect(svc.vehicle?.latitude).toBeNull()
  })

  it("an explicit `plate` field wins over `license_plate` when both are present", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.driverVehicle]?.(driverVehicleRow({ plate: "KDZ 999Z" }))

    expect(svc.vehicle?.plate).toBe("KDZ 999Z")
  })

  it("a moving vehicle with real numeric coords still parses (mixed number/string wire types)", () => {
    const { svc, handlers } = driverFeed()

    handlers[RealtimeEvents.driverVehicle]?.(
      driverVehicleRow({
        display_state: "MOVING",
        latitude: -1.2921,
        longitude: 36.8219,
        last_speed_kph: "62.50",
        fuel_level_pct: 58, // some producers send a real number
      }),
    )

    expect(svc.vehicle?.display_state).toBe("MOVING")
    expect(svc.vehicle?.latitude).toBeCloseTo(-1.2921)
    expect(svc.vehicle?.fuel_level_pct).toBe(58)
  })

  it("REST snapshot fallback maps license_plate → plate as well", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (_m, url) =>
        url.endsWith("/dashboard/vehicle-states")
          ? { status: 200, json: { vehicles: [driverVehicleRow()] } }
          : { status: 204 },
    })
    const { factory } = fakeSocketFactory()
    const socket = new SocketClient({ url: "w", getToken: () => "t", factory })
    const svc = new FeedService(api, socket)

    await svc.loadVehicleState(VEHICLE)

    expect(svc.vehicle?.plate).toBe("KDA 123A")
    expect(svc.vehicle?.odometer_km).toBe(12345)
  })

  it("a trailer sub-object with string numerics parses", () => {
    const parsed = VehicleStateSchema.parse(
      driverVehicleRow({ trailer: { code: "TR-77", load_kg: "18500", temp_c: "-4.5" } }),
    )
    expect(parsed.trailer?.load_kg).toBe(18500)
    expect(parsed.trailer?.temp_c).toBe(-4.5)
  })
})

describe("REGRESSION driver expiring documents — PG date + string days_remaining", () => {
  it("listDocuments keeps rows whose expires_on is YYYY-MM-DD", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (_m, url) =>
        url.includes("/documents/expiring")
          ? {
              status: 200,
              json: {
                data: [
                  {
                    document_id: uid(950),
                    document_type: "LICENCE",
                    subject_id: uid(951),
                    subject_name: "Peter Mwangi",
                    expires_on: "2026-09-01",
                    days_remaining: "23",
                  },
                ],
                next_cursor: null,
                has_more: false,
              },
            }
          : { status: 204 },
    })
    const { factory } = fakeSocketFactory()
    const svc = new FeedService(api, new SocketClient({ url: "w", getToken: () => "t", factory }))

    const docs = await svc.listDocuments(30)

    expect(docs).toHaveLength(1)
    expect(docs[0]!.expires_on).toBe("2026-09-01")
    expect(docs[0]!.days_remaining).toBe(23)
  })
})
