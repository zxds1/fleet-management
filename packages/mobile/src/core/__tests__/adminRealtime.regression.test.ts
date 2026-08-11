// packages/mobile/src/core/__tests__/adminRealtime.regression.test.ts
//
// REGRESSION SUITE — admin live map + notifications + expiring documents.
//
// These tests deliberately use the payload shapes the *real* backend emits rather than the
// idealized fixtures the original suite used. Concretely:
//   • `app.v_vehicle_display_state` (db/schema/11_views.sql) projects `license_plate` (not `plate`),
//     `latitude`/`longitude` computed via ST_Y/ST_X which are NULL for a vehicle with no GPS fix,
//     and PG `numeric` columns (`last_speed_kph`, fuel/odometer telemetry) that arrive as STRINGS.
//   • The ws gateway emits the vehicle-state snapshot as a BARE ARRAY
//     (`socket.emit(EVENT_VEHICLES, snapshot)`, packages/ws/src/gateway.ts §handleConnection) and
//     notifications as an ARRAY both on (re)connect and on live fan-out (`[notification]`).
//   • `app.asset_documents.expires_on` is a PG `date` → `YYYY-MM-DD`, not an ISO datetime.
//
// Each `it` locks in a defect that previously caused silent data loss (a blanked fleet, a dropped
// push, a swallowed notification, an empty documents page).

import {
  DashboardService,
  DocumentService,
  NotificationService,
  VehicleStatesResponseSchema,
  VehicleStateSchema,
  DocumentRowSchema,
} from "../admin"
import { SocketClient, type SocketFactory, type SocketLike } from "../socket"
import { RealtimeEvents } from "@fleet/shared/mobile"
import { makeApi, uid } from "./testkit"

/** Fake Socket.IO that records `on` handlers so a test can push a gateway payload verbatim. */
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

function adminSocket(): { client: SocketClient; handlers: Record<string, (...a: unknown[]) => void> } {
  const { factory, handlers } = fakeSocketFactory()
  const client = new SocketClient({ url: "wss://ws.fleet.internal", getToken: () => "tok", factory })
  client.connect("admin")
  return { client, handlers }
}

const VEH_FIXED_1 = uid(101)
const VEH_FIXED_2 = uid(102)
const VEH_NO_FIX = uid(103)

/**
 * A realistic `app.v_vehicle_display_state` row as it crosses the wire: PG `numeric` → string,
 * plate under `license_plate`, timestamps as ISO strings.
 */
function displayStateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vehicle_id: VEH_FIXED_1,
    license_plate: "KDA 123A",
    vehicle_class: "TRUCK",
    asset_status: "ACTIVE",
    is_operational: true,
    shift_id: uid(201),
    driver_id: uid(301),
    driver_name: "Peter Mwangi",
    last_position: "0101000020E6100000",
    latitude: -1.2921,
    longitude: 36.8219,
    last_position_at: "2026-08-09T09:15:00.000Z",
    last_speed_kph: "62.50", // PG numeric → string
    last_ignition: true,
    is_online: true,
    next_eligible_clock_in_at: null,
    limit_reached_at: null,
    warning_sent_at: null,
    display_state: "MOVING",
    ...over,
  }
}

/** The un-fixed vehicle: parked in the yard, tracker has no GPS lock → ST_Y/ST_X return NULL. */
function unfixedRow(): Record<string, unknown> {
  return displayStateRow({
    vehicle_id: VEH_NO_FIX,
    license_plate: "KDB 456B",
    display_state: "PARKED",
    latitude: null,
    longitude: null,
    last_position: null,
    last_position_at: "2026-08-09T06:00:00.000Z",
    last_speed_kph: "0.00",
    last_ignition: false,
    shift_id: null,
    driver_id: null,
    driver_name: null,
    fuel_level_pct: "62.50",
    odometer_km: "12345",
  })
}

describe("REGRESSION admin live map — a vehicle with no GPS fix must not blank the fleet", () => {
  it("VehicleStateSchema accepts latitude/longitude NULL and string numerics", () => {
    const parsed = VehicleStateSchema.parse(unfixedRow())
    expect(parsed.vehicle_id).toBe(VEH_NO_FIX)
    expect(parsed.display_state).toBe("PARKED")
    // Null coords must normalize to null — never throw, never NaN.
    expect(parsed.latitude).toBeNull()
    expect(parsed.longitude).toBeNull()
  })

  it("keeps every row when one of three has null coords (array length preserved)", () => {
    const rows = [
      displayStateRow(),
      displayStateRow({ vehicle_id: VEH_FIXED_2, license_plate: "KDC 789C", display_state: "IDLING" }),
      unfixedRow(),
    ]

    const parsed = VehicleStatesResponseSchema.parse({ vehicles: rows })

    expect(parsed.vehicles).toHaveLength(3)
    const ids = parsed.vehicles.map((v) => v.vehicle_id)
    expect(ids).toContain(VEH_NO_FIX)
    const unfixed = parsed.vehicles.find((v) => v.vehicle_id === VEH_NO_FIX)
    expect(unfixed?.latitude).toBeNull()
    expect(unfixed?.display_state).toBe("PARKED")
  })

  it("DashboardService keeps the un-fixed vehicle in the map state and in the counts", () => {
    const { client, handlers } = adminSocket()
    const dash = new DashboardService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    dash.bindSocket()

    handlers[RealtimeEvents.vehicleStates]?.([displayStateRow(), unfixedRow()])

    expect(dash.vehicles).toHaveLength(2)
    expect(dash.vehicles.map((v) => v.vehicle_id)).toContain(VEH_NO_FIX)
    // Both are non-QUARANTINED / non-OFFLINE, so both count as active.
    expect(dash.counts.active).toBe(2)
  })

  it("REST snapshot also survives a null-coord row", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (_m, url) =>
        url.endsWith("/dashboard/vehicle-states")
          ? { status: 200, json: { vehicles: [displayStateRow(), unfixedRow()] } }
          : { status: 204 },
    })
    const { client } = adminSocket()
    const dash = new DashboardService(api, client)
    await dash.loadVehicles()

    expect(dash.vehicles).toHaveLength(2)
    expect(dash.vehicles.find((v) => v.vehicle_id === VEH_NO_FIX)?.longitude).toBeNull()
  })
})

describe("REGRESSION admin live map — BARE ARRAY push from the gateway", () => {
  it("accepts the bare array the gateway actually emits (EVENT_VEHICLES, snapshot)", () => {
    const { client, handlers } = adminSocket()
    const dash = new DashboardService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    dash.bindSocket()

    // packages/ws/src/gateway.ts: `socket.emit(EVENT_VEHICLES, snapshot)` where snapshot is an array.
    handlers[RealtimeEvents.vehicleStates]?.([
      displayStateRow(),
      displayStateRow({ vehicle_id: VEH_FIXED_2, license_plate: "KDC 789C", display_state: "QUARANTINED" }),
    ])

    expect(dash.vehicles).toHaveLength(2)
    expect(dash.vehicles.map((v) => v.vehicle_id)).toEqual([VEH_FIXED_1, VEH_FIXED_2])
    expect(dash.counts.quarantined).toBe(1)
  })

  it("still accepts the { vehicles: [...] } envelope (REST-shaped push)", () => {
    const { client, handlers } = adminSocket()
    const dash = new DashboardService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    dash.bindSocket()

    handlers[RealtimeEvents.vehicleStates]?.({ vehicles: [displayStateRow()] })

    expect(dash.vehicles).toHaveLength(1)
    expect(dash.vehicles[0]!.vehicle_id).toBe(VEH_FIXED_1)
  })

  it("a bare-array diff push (gateway fan-out) replaces the map without blanking it", () => {
    const { client, handlers } = adminSocket()
    const dash = new DashboardService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    dash.bindSocket()

    handlers[RealtimeEvents.vehicleStates]?.([displayStateRow(), unfixedRow()])
    expect(dash.vehicles).toHaveLength(2)

    // `diffVehicleStates` emits only the changed rows — still a bare array.
    handlers[RealtimeEvents.vehicleStates]?.([displayStateRow({ display_state: "SPEEDING", last_speed_kph: "95.40" })])
    expect(dash.vehicles).toHaveLength(1)
    expect(dash.vehicles[0]!.display_state).toBe("SPEEDING")
  })

  it("a malformed push leaves the previous fleet intact (no silent blanking)", () => {
    const { client, handlers } = adminSocket()
    const dash = new DashboardService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    dash.bindSocket()

    handlers[RealtimeEvents.vehicleStates]?.([displayStateRow()])
    expect(dash.vehicles).toHaveLength(1)

    handlers[RealtimeEvents.vehicleStates]?.([{ vehicle_id: "not-a-uuid", display_state: "WAT" }])
    expect(dash.vehicles).toHaveLength(1)
    expect(dash.vehicles[0]!.vehicle_id).toBe(VEH_FIXED_1)
  })
})

describe("REGRESSION admin notifications — the gateway emits an ARRAY", () => {
  const N1 = uid(401)
  const N2 = uid(402)

  /** `app.notifications` row as projected by `GET /notifications` / the ws fan-out. */
  function notificationRow(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      title: "Document expiring",
      body: "Insurance for KDA 123A expires in 5 days",
      priority: "HIGH",
      status: "QUEUED",
      created_at: "2026-08-09T09:20:00.000Z",
      payload: { document_id: uid(501) },
      ...over,
    }
  }

  it("(a) parses the ARRAY form — the (re)connect snapshot and live fan-out `[notification]`", () => {
    const { client, handlers } = adminSocket()
    const svc = new NotificationService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    svc.bindSocket()

    handlers[RealtimeEvents.notifications]?.([notificationRow(N1), notificationRow(N2, { title: "HOS warning" })])

    expect(svc.notifications).toHaveLength(2)
    expect(svc.notifications.map((n) => n.id).sort()).toEqual([N1, N2].sort())
    expect(svc.unreadCount).toBe(2)
  })

  it("(b) parses a BARE OBJECT row", () => {
    const { client, handlers } = adminSocket()
    const svc = new NotificationService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    svc.bindSocket()

    handlers[RealtimeEvents.notifications]?.(notificationRow(N1))

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.id).toBe(N1)
  })

  it("(c) parses the { userId, notification } envelope", () => {
    const { client, handlers } = adminSocket()
    const svc = new NotificationService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    svc.bindSocket()

    handlers[RealtimeEvents.notifications]?.({ userId: uid(601), notification: notificationRow(N1) })

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.id).toBe(N1)
  })

  it("an empty array (user with no notifications) is a no-op, not a crash", () => {
    const { client, handlers } = adminSocket()
    const svc = new NotificationService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    svc.bindSocket()

    expect(() => handlers[RealtimeEvents.notifications]?.([])).not.toThrow()
    expect(svc.notifications).toHaveLength(0)
  })

  it("re-delivery of the same id de-duplicates instead of stacking", () => {
    const { client, handlers } = adminSocket()
    const svc = new NotificationService(makeApi({ calls: [], onRequest: () => ({ status: 200 }) }), client)
    svc.bindSocket()

    handlers[RealtimeEvents.notifications]?.([notificationRow(N1)])
    handlers[RealtimeEvents.notifications]?.([notificationRow(N1, { status: "DELIVERED" })])

    expect(svc.notifications).toHaveLength(1)
    expect(svc.notifications[0]!.status).toBe("DELIVERED")
    expect(svc.unreadCount).toBe(0)
  })
})

describe("REGRESSION expiring documents — expires_on is a PG date (YYYY-MM-DD)", () => {
  const DOC1 = uid(701)

  it("DocumentRowSchema parses a bare YYYY-MM-DD expires_on", () => {
    const parsed = DocumentRowSchema.parse({
      document_id: DOC1,
      document_type: "INSURANCE",
      subject_id: uid(702),
      subject_name: "KDA 123A",
      expires_on: "2026-09-01", // PG `date`, NOT an ISO datetime
      days_remaining: "23", // PG numeric/int → string over REST
    })

    expect(parsed.expires_on).toBe("2026-09-01")
    expect(parsed.days_remaining).toBe(23)
  })

  it("DocumentService.load keeps date-only rows (page is not silently emptied)", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (_m, url) =>
        url.includes("/documents/expiring")
          ? {
              status: 200,
              json: {
                data: [
                  {
                    document_id: DOC1,
                    document_type: "INSURANCE",
                    subject_id: uid(702),
                    subject_name: "KDA 123A",
                    expires_on: "2026-09-01",
                    days_remaining: "23",
                  },
                  {
                    document_id: uid(703),
                    document_type: "INSPECTION",
                    subject_id: uid(704),
                    subject_name: "KDB 456B",
                    expires_on: "2026-08-15",
                    days_remaining: "6",
                  },
                ],
                next_cursor: null,
                has_more: false,
              },
            }
          : { status: 204 },
    })
    const svc = new DocumentService(api)
    await svc.load(30)

    expect(svc.documents).toHaveLength(2)
    expect(svc.documents[0]!.expires_on).toBe("2026-09-01")
    expect(svc.documents[1]!.days_remaining).toBe(6)
  })

  it("a null expires_on (document with no expiry) still parses", () => {
    const parsed = DocumentRowSchema.parse({
      document_id: DOC1,
      document_type: "PERMIT",
      subject_id: uid(702),
      subject_name: "KDA 123A",
      expires_on: null,
      days_remaining: null,
    })
    expect(parsed.expires_on).toBeNull()
  })
})
