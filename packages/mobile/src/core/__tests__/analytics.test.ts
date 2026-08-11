// packages/mobile/src/core/__tests__/analytics.test.ts
//
// Covers the hierarchical analytics slice: the five endpoint bindings, the tolerant parsing the
// backend contract requires (every field optional, PG numerics as strings), and the `flattenKpis`
// normalisation that lets the screen read nested-or-inline KPI blocks uniformly.

import { ApiClient } from "../apiClient"
import { AnalyticsService, flattenKpis, resolveViewerRole } from "../analytics"

/** Records every path requested and replies with the queued JSON body. */
function makeApi(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    const path = url.replace("https://x/api/v1", "")
    calls.push(path)
    const body = routes[path]
    if (body === undefined) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  const api = new ApiClient({ baseUrl: "https://x/api/v1", fetchImpl, getToken: () => "tok" })
  return { api, calls }
}

describe("AnalyticsService", () => {
  it("binds each level of the hierarchy to its endpoint", async () => {
    const { api, calls } = makeApi({
      "/analytics/company": { managers: [] },
      "/analytics/manager/m1": { user_id: "m1" },
      "/analytics/vehicle/v1": { vehicle_id: "v1" },
      "/analytics/driver/d1": { driver_id: "d1" },
      "/analytics/me": { driver_id: "self" },
    })
    const svc = new AnalyticsService(api)

    await svc.getCompany()
    await svc.getManager("m1")
    await svc.getVehicle("v1")
    await svc.getDriver("d1")
    await svc.getMine()

    expect(calls).toEqual([
      "/analytics/company",
      "/analytics/manager/m1",
      "/analytics/vehicle/v1",
      "/analytics/driver/d1",
      "/analytics/me",
    ])
    expect(svc.driver?.driver_id).toBe("self")
  })

  it("parses the documented company payload including the manager roster", async () => {
    const { api } = makeApi({
      "/analytics/company": {
        companyName: "Acme",
        kpis: { vehicles: 12, drivers: 30, distanceKm: "18450.5", fuelCost: "920000", anomalies: 4 },
        managers: [
          {
            user_id: "m1",
            full_name: "Asha Maina",
            email: "asha@acme.co.ke",
            assignedVehicleIds: ["v1", "v2"],
            assignedDriverIds: ["d1"],
            kpis: { vehicles: 2, drivers: 1, distanceKm: 800, fuelCost: 41000, anomalies: 1 },
          },
        ],
      },
    })
    const company = await new AnalyticsService(api).getCompany()

    expect(company?.companyName).toBe("Acme")
    expect(company?.managers).toHaveLength(1)
    // PG numerics arriving as strings are coerced.
    expect(flattenKpis(company ?? {}).distanceKm).toBe(18450.5)
    expect(flattenKpis(company?.managers?.[0] ?? {}).vehicles).toBe(2)
  })

  it("tolerates a payload missing every optional field instead of throwing", async () => {
    const { api } = makeApi({ "/analytics/company": {} })
    const company = await new AnalyticsService(api).getCompany()
    // Parsing succeeds; absent numerics normalise to null rather than voiding the whole screen.
    expect(company).not.toBeNull()
    expect(company?.managers).toBeUndefined()
    expect(flattenKpis(company ?? {})).toEqual({
      vehicles: null,
      drivers: null,
      distanceKm: null,
      fuelCost: null,
      anomalies: null,
      utilisationPct: null,
      shifts: null,
    })
  })

  it("resolves an unparseable payload to null rather than an error", async () => {
    const { api } = makeApi({ "/analytics/company": "not-an-object" })
    expect(await new AnalyticsService(api).getCompany()).toBeNull()
  })

  it("parses a manager's vehicle + driver rosters for the drill-down lists", async () => {
    const { api } = makeApi({
      "/analytics/manager/m1": {
        user_id: "m1",
        kpis: { distanceKm: 800 },
        vehicles: [{ vehicle_id: "v1", plate: "KDA 001A", distanceKm: 500, utilisationPct: 72 }],
        drivers: [{ driver_id: "d1", name: "Juma", distanceKm: 300, shifts: 9 }],
      },
    })
    const m = await new AnalyticsService(api).getManager("m1")

    expect(m?.vehicles?.[0]?.plate).toBe("KDA 001A")
    expect(m?.drivers?.[0]?.shifts).toBe(9)
    // The roster arrays double as the counts when the KPI block omits them.
    const k = flattenKpis(m ?? {})
    expect(k.vehicles).toBe(1)
    expect(k.drivers).toBe(1)
    expect(k.distanceKm).toBe(800)
  })

  it("prefers explicit KPI counts over roster lengths", () => {
    const k = flattenKpis({ kpis: { vehicles: 40 }, vehicles: [{}, {}] })
    expect(k.vehicles).toBe(40)
  })
})

describe("resolveViewerRole", () => {
  it("gives ADMIN the company root", () => {
    expect(resolveViewerRole(["ADMIN"])).toBe("admin")
    // An admin who also manages a fleet keeps the wider scope.
    expect(resolveViewerRole(["FLEET_MANAGER", "ADMIN"])).toBe("admin")
  })

  it("scopes a fleet manager to their own node", () => {
    expect(resolveViewerRole(["FLEET_MANAGER"])).toBe("manager")
  })

  it("defaults to the most restrictive scope for drivers and unknown roles", () => {
    expect(resolveViewerRole(["DRIVER"])).toBe("driver")
    expect(resolveViewerRole([])).toBe("driver")
    expect(resolveViewerRole(undefined)).toBe("driver")
    expect(resolveViewerRole(["SOMETHING_NEW"])).toBe("driver")
  })
})
