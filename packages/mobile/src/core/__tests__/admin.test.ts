// packages/mobile/src/core/__tests__/admin.test.ts
import { ApiClient } from "../apiClient"
import {
  DashboardService,
  AccidentConsoleService,
  AnomalyService,
  DocumentService,
  FuelReconcileService,
  VerificationService,
  SecurityService,
  DriverRosterService,
} from "../admin"
import { makeApi, uid } from "./testkit"
import { SocketClient, type SocketFactory } from "../socket"
import type { SocketLike } from "../socket"

function fakeSocket(): { socket: SocketLike; emits: Record<string, unknown[]> } {
  const handlerMap = new Map<string, Array<(...a: unknown[]) => void>>()
  const emits: Record<string, unknown[]> = {}
  const socket: SocketLike = {
    connected: true,
    connect() {},
    disconnect() {},
    on(event: string, handler: (...a: unknown[]) => void) {
      const set = handlerMap.get(event) ?? []
      set.push(handler)
      handlerMap.set(event, set)
    },
    off() {},
    emit(event: string, ...args: unknown[]) {
      emits[event] = [...(emits[event] ?? []), ...args]
    },
    io: { opts: { auth: { token: "t" } } },
  }
  ;(socket as any)._dispatch = (event: string, payload: unknown) => {
    ;(handlerMap.get(event) ?? []).forEach((h) => h(payload))
  }
  return { socket, emits }
}

function makeSocketClient(impl: SocketLike): { client: SocketClient; dispatch: (e: string, p: unknown) => void } {
  const factory: SocketFactory = () => impl
  const client = new SocketClient({ url: "wss://x", getToken: () => "tok", factory })
  return { client, dispatch: (e, p) => (impl as any)._dispatch(e, p) }
}

describe("admin core services", () => {
  it("DashboardService loads vehicle snapshot and updates from socket", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url) => {
        if (url.endsWith("/dashboard/vehicle-states")) {
          return { status: 200, json: { vehicles: [{ vehicle_id: uid(1), display_state: "MOVING", latitude: -1.2, longitude: 36.8 }] } }
        }
        return { status: 204 }
      },
    })
    const { socket } = fakeSocket()
    const { client, dispatch } = makeSocketClient(socket)
    client.connect("admin")
    const dash = new DashboardService(api, client)
    dash.bindSocket()
    await dash.loadVehicles()
    expect(dash.vehicles).toHaveLength(1)
    expect(dash.counts.active).toBe(1)

    dispatch("map:vehicle-states", { vehicles: [{ vehicle_id: uid(2), display_state: "QUARANTINED" }] })
    expect(dash.vehicles).toHaveLength(1)
    expect(dash.vehicles[0]!.display_state).toBe("QUARANTINED")
    expect(dash.counts.quarantined).toBe(1)
  })

  it("AccidentConsoleService verifies the telemetry hash chain", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url) => {
        if (url.endsWith("/telemetry/verify")) return { status: 200, json: { all_valid: true, rows: [{ sequence: 1, is_valid: true }] } }
        return { status: 204 }
      },
    })
    const { socket } = fakeSocket()
    const { client, dispatch } = makeSocketClient(socket)
    client.connect("admin")
    const svc = new AccidentConsoleService(api, client)
    svc.bindSocket()
    dispatch("accident:live", { accident_id: uid(9), tier: 1, acknowledged: false })
    expect(svc.accidents).toHaveLength(1)
    const r = await svc.verifyChain(uid(9))
    expect(r.allValid).toBe(true)
    expect(r.rows).toBe(1)
    svc.acknowledge(uid(9))
    expect(svc.accidents[0]!.acknowledged).toBe(true)
  })

  it("AnomalyService loads the open-anomaly feed", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url) =>
        url.includes("/anomalies")
          ? { status: 200, json: { data: [{ id: uid(3), domain: "FUEL", severity: "HIGH", title: "Leak", created_at: "2026-01-01T00:00:00.000Z" }], next_cursor: null, has_more: false } }
          : { status: 204 },
    })
    const svc = new AnomalyService(api)
    const page = await svc.load(["FUEL"])
    expect(page.hasMore).toBe(false)
    expect(svc.anomalies).toHaveLength(1)
    expect(svc.anomalies[0]!.domain).toBe("FUEL")
  })

  it("DocumentService loads expiring documents", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url) =>
        url.includes("/documents/expiring")
          ? { status: 200, json: { data: [{ document_id: uid(4), document_type: "INSURANCE", subject_name: "KBL 123", expires_on: "2026-02-01T00:00:00.000Z", days_remaining: 5 }], next_cursor: null, has_more: false } }
          : { status: 204 },
    })
    const svc = new DocumentService(api)
    await svc.load(30)
    expect(svc.documents).toHaveLength(1)
    expect(svc.documents[0]!.days_remaining).toBe(5)
  })

  it("FuelReconcileService verifies a purchase and imports a statement", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url, body) => {
        if (url.includes("/fuel/reconciliation-inbox"))
          return { status: 200, json: { data: [{ fuel_purchase_id: uid(5), litres: "50", total_cost: "8000", currency: "KES", vehicle_plate: "KBL 1", admin_verified: false }], next_cursor: null, has_more: false } }
        if (url.includes("/fuel/purchases/" + uid(5) + "/verify")) return { status: 200, json: {} }
        if (url.includes("/reconciliation/statements")) return { status: 201, json: { statement_id: uid(6) } }
        return { status: 204 }
      },
    })
    const svc = new FuelReconcileService(api)
    await svc.load()
    expect(svc.rows).toHaveLength(1)
    await svc.verify(uid(5), { action: "VERIFY" })
    expect(svc.rows[0]!.admin_verified).toBe(true)
    const r = await svc.importStatement({ provider: "Shell", period_start: "2026-01-01", period_end: "2026-01-31", media_object_id: uid(7) })
    expect(r.statementId).toBe(uid(6))
  })

  it("VerificationService lists and flags a shift", async () => {
    const api = makeApi({
      calls: [],
      onRequest: (method, url, body) => {
        if (url.includes("/shifts/verification-inbox"))
          return { status: 200, json: { data: [{ shift_id: uid(8), driver_name: "Jane", verification_status: "PENDING", state: "PENDING_CLOSEOUT" }], next_cursor: null, has_more: false } }
        if (url.includes("/shifts/" + uid(8) + "/verify")) return { status: 200, json: {} }
        return { status: 204 }
      },
    })
    const svc = new VerificationService(api)
    await svc.load()
    expect(svc.rows).toHaveLength(1)
    await svc.verify(uid(8), { action: "FLAG", flagReason: "mismatch" })
    expect(svc.rows[0]!.verification_status).toBe("FLAGGED")
    expect(svc.rows[0]!.flag_reason).toBe("mismatch")
  })

  it("SecurityService enrolls driver MFA and revokes a device", async () => {
    const calls: string[] = []
    const api = makeApi({
      calls: [],
      onRequest: (method, url, body) => {
        calls.push(url)
        if (url.endsWith("/auth/mfa/enroll")) return { status: 200, json: { provisioning_uri: "otpauth://x", recovery_codes: ["A1B2", "C3D4"] } }
        if (url.includes("/devices/") && url.endsWith("/revoke")) return { status: 204 }
        return { status: 204 }
      },
    })
    const svc = new SecurityService(api)
    const enroll = await svc.enrollDriverMfa("secret")
    expect(enroll.recovery_codes).toEqual(["A1B2", "C3D4"])
    await svc.revokeDevice(uid(11) + ":device1")
    expect(calls.some((c) => c.includes("/devices/") && c.endsWith("/revoke"))).toBe(true)
  })

  it("DriverRosterService loads the roster from GET /drivers (locked contract)", async () => {
    let called = ""
    const api = makeApi({
      calls: [],
      onRequest: (method, url) => {
        called = url
        if (url.includes("/drivers"))
          return {
            status: 200,
            json: {
              data: [
                { user_id: uid(21), email: "a@fleet.co.ke", full_name: "Amy", mfa_enrolled: true, status: "ACTIVE", devices: [{ device_id: "dev-1", platform: "android" }] },
                { user_id: uid(22), email: "b@fleet.co.ke", full_name: "Bob", mfa_enrolled: false, status: "SUSPENDED" },
              ],
              next_cursor: null,
              has_more: false,
            },
          }
        return { status: 204 }
      },
    })
    const svc = new DriverRosterService(api)
    const page = await svc.load()
    expect(called).toContain("/drivers")
    expect(page.hasMore).toBe(false)
    expect(svc.drivers).toHaveLength(2)
    expect(svc.drivers[0]!.mfa_enrolled).toBe(true)
    expect(svc.drivers[0]!.devices?.[0]?.device_id).toBe("dev-1")
    expect(svc.drivers[1]!.status).toBe("SUSPENDED")
  })

  it("creates a PENDING driver and approves them (A3.7)", async () => {
    const calls: string[] = []
    const api = makeApi({
      calls: [],
      onRequest: (method, url, body) => {
        calls.push(`${method} ${url}`)
        if (url.includes("/drivers") && method === "POST" && !url.includes("/approve"))
          return { status: 201, json: { user_id: uid(31), status: "PENDING" } }
        if (url.includes("/approve") && method === "POST") return { status: 200, json: { approved: true } }
        return { status: 204 }
      },
    })
    const svc = new DriverRosterService(api)
    const created = await svc.createDriver({ phone: "+254712345678", full_name: "Asha Maina", password: "Trucking!2026Safe" })
    expect(created.status).toBe("PENDING")
    const approved = await svc.approveDriver(created.user_id)
    expect(approved.approved).toBe(true)
    expect(calls.some((c) => c.includes("POST") && c.includes("/drivers") && !c.includes("/approve"))).toBe(true)
    expect(calls.some((c) => c.includes("/approve"))).toBe(true)
  })
})
