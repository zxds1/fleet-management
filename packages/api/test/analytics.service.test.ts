// packages/api/test/analytics.service.test.ts
// Scope-aware analytics (services/scope.ts + services/analytics.ts).
//
// The point of these tests is the SCOPE, not the SQL dialect, so they run against a fake DbClient
// that seeds an in-memory tenant (vehicles, drivers, shifts, fuel_purchases, manager_assignments)
// and answers each query by inspecting the SQL it was handed plus the bound parameters. That lets
// us assert the thing that actually matters for isolation: which ids reach the WHERE clause.
//
// Covered:
//   * ADMIN            → whole-company totals, no id narrowing.
//   * FLEET_MANAGER    → only their assigned vehicles, and the unassigned manager sees nothing.
//   * DRIVER           → only their own driver row.
//   * cross-tenant/out-of-scope ids are refused rather than silently answered.

import type { DbClient, Principal } from "@fleet/shared";
import { AnalyticsService, resolveRange } from "../src/services/analytics";
import { resolveScope, type ResolvedScope } from "../src/services/scope";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

const V1 = "aaaaaaa1-0000-0000-0000-000000000001";
const V2 = "aaaaaaa2-0000-0000-0000-000000000002";
const V3 = "aaaaaaa3-0000-0000-0000-000000000003";

const D1 = "bbbbbbb1-0000-0000-0000-000000000001";
const D2 = "bbbbbbb2-0000-0000-0000-000000000002";

const U_ADMIN = "ccccccc1-0000-0000-0000-000000000001";
const U_MANAGER = "ccccccc2-0000-0000-0000-000000000002";
const U_MANAGER_UNASSIGNED = "ccccccc3-0000-0000-0000-000000000003";
const U_DRIVER1 = "ccccccc4-0000-0000-0000-000000000004";

// ── Seed ────────────────────────────────────────────────────────────────────────────────────────
// Two vehicles + one driver belong to the manager's scope; V3/D2 do not. Everything is inside
// TENANT except one vehicle parked in OTHER_TENANT to prove the tenant filter is applied.

const vehicles = [
  { id: V1, tenant_id: TENANT, plate: "KAA 001A", status: "AVAILABLE" },
  { id: V2, tenant_id: TENANT, plate: "KAB 002B", status: "AVAILABLE" },
  { id: V3, tenant_id: TENANT, plate: "KAC 003C", status: "AVAILABLE" },
  { id: "dddddddd-0000-0000-0000-00000000000f", tenant_id: OTHER_TENANT, plate: "ZZZ 999Z", status: "AVAILABLE" },
];

const drivers = [
  { id: D1, tenant_id: TENANT, user_id: U_DRIVER1, name: "Asha Mwangi" },
  { id: D2, tenant_id: TENANT, user_id: "ccccccc5-0000-0000-0000-000000000005", name: "Baraka Otieno" },
];

const shifts = [
  { tenant_id: TENANT, vehicle_id: V1, driver_id: D1, distance: 120, day: "2026-07-02" },
  { tenant_id: TENANT, vehicle_id: V1, driver_id: D1, distance: 80, day: "2026-07-03" },
  { tenant_id: TENANT, vehicle_id: V2, driver_id: D2, distance: 200, day: "2026-07-02" },
  { tenant_id: TENANT, vehicle_id: V3, driver_id: D2, distance: 500, day: "2026-07-04" },
];

const fuelPurchases = [
  { tenant_id: TENANT, vehicle_id: V1, driver_id: D1, cost: 100 },
  { tenant_id: TENANT, vehicle_id: V2, driver_id: D2, cost: 250 },
  { tenant_id: TENANT, vehicle_id: V3, driver_id: D2, cost: 900 },
];

const anomalies = [
  { vehicle_id: V1, driver_id: D1 },
  { vehicle_id: V3, driver_id: D2 },
];

/** `app.manager_assignments`: the manager is scoped to V1 + V2 on the vehicle axis only. */
const managerAssignments = [
  { tenant_id: TENANT, user_id: U_MANAGER, vehicle_id: V1, driver_id: null },
  { tenant_id: TENANT, user_id: U_MANAGER, vehicle_id: V2, driver_id: null },
];

const managerUsers = [
  { user_id: U_MANAGER, email: "manager@acme.test", full_name: "Mia Manager" },
  { user_id: U_MANAGER_UNASSIGNED, email: "new.manager@acme.test", full_name: "Newt Manager" },
];

// ── Fake client ─────────────────────────────────────────────────────────────────────────────────

interface Recorded {
  sql: string;
  params: unknown[];
}

/**
 * Interprets the handful of query shapes the service issues. Filtering is reproduced in JS: a
 * `... = ANY($n)` fragment in the SQL means the corresponding id array narrows the rows, and its
 * ABSENCE means unrestricted — the exact semantic the service relies on.
 */
function fakeClient(): DbClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];

  const client = {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const tenantId = params[0] as string;

      // Which id arrays were bound? They are every uuid[] parameter after the tenant id.
      const arrays = params.filter((p): p is string[] => Array.isArray(p));
      const vehicleScope = /v\.id = ANY|vehicle_id = ANY|an\.vehicle_id = ANY|sh\.vehicle_id = ANY|fp\.vehicle_id = ANY/.test(sql)
        ? arrays[0] ?? null
        : null;

      const inVehicleScope = (id: string | null) =>
        vehicleScope === null || (id !== null && vehicleScope.includes(id));

      // Scope arrays for driver-keyed queries: when both dimensions are bound the vehicle array is
      // first, so the driver array is whichever remaining array contains driver ids.
      const driverArray =
        arrays.find((a) => a.some((id) => id === D1 || id === D2)) ??
        (/d\.id = ANY|driver_id = ANY/.test(sql) ? arrays[0] ?? null : null);
      const driverScoped = /d\.id = ANY|sh\.driver_id = ANY|fp\.driver_id = ANY|an\.driver_id = ANY/.test(sql);
      const inDriverScope = (id: string | null) =>
        !driverScoped || driverArray === null || (id !== null && driverArray.includes(id));

      // Rows visible when EITHER dimension matches (shifts / fuel / anomalies).
      const either = (v: string | null, d: string | null) => {
        const vRestricted = vehicleScope !== null;
        const dRestricted = driverScoped && driverArray !== null;
        if (!vRestricted && !dRestricted) return true;
        return (vRestricted && inVehicleScope(v)) || (dRestricted && inDriverScope(d));
      };

      // ── manager_assignments (resolveScope / scopeOfManager). Matched on the standalone form,
      //    since the roster query also references the table in subqueries. ────────────────────
      if (sql.includes("FROM app.manager_assignments") && sql.includes("WHERE user_id = $1")) {
        const userId = params[0] as string;
        const tid = params[1] as string;
        return rows(
          managerAssignments
            .filter((a) => a.user_id === userId && a.tenant_id === tid)
            .map((a) => ({ vehicle_id: a.vehicle_id, driver_id: a.driver_id })),
        );
      }

      // ── driver lookup by user (resolveScope DRIVER / driverIdForUser) ───────────────────────
      if (sql.includes("FROM app.drivers") && sql.includes("user_id = $1")) {
        const userId = params[0] as string;
        const tid = params[1] as string;
        const d = drivers.find((x) => x.user_id === userId && x.tenant_id === tid);
        return rows(d ? [{ id: d.id }] : []);
      }

      // ── existence checks ────────────────────────────────────────────────────────────────────
      if (sql.includes("FROM app.vehicles WHERE id = $1")) {
        const [id, tid] = params as [string, string];
        return rows(vehicles.filter((v) => v.id === id && v.tenant_id === tid).map((v) => ({ id: v.id })));
      }
      if (sql.includes("FROM app.drivers WHERE id = $1")) {
        const [id, tid] = params as [string, string];
        return rows(drivers.filter((d) => d.id === id && d.tenant_id === tid).map((d) => ({ id: d.id })));
      }
      // ── manager roster for the company roll-up (checked before the single-user lookup, since
      //    both select FROM app.users u) ──────────────────────────────────────────────────────
      if (sql.includes("role_code = 'FLEET_MANAGER'")) {
        // The service's manager roster query now LEFT JOINs manager_assignments so each manager
        // yields one row per assignment (vehicle_id/driver_id) plus a single NULL row when a
        // manager has no assignments. Emit that denormalised shape so managerSummaries can group.
        const rowsOut: Record<string, unknown>[] = [];
        for (const m of managerUsers) {
          const asg = managerAssignments.filter((a) => a.user_id === m.user_id);
          if (asg.length === 0) {
            rowsOut.push({ user_id: m.user_id, email: m.email, full_name: m.full_name, vehicle_id: null, driver_id: null });
          } else {
            for (const a of asg) {
              rowsOut.push({
                user_id: m.user_id,
                email: m.email,
                full_name: m.full_name,
                vehicle_id: a.vehicle_id ?? null,
                driver_id: a.driver_id ?? null,
              });
            }
          }
        }
        return rows(rowsOut);
      }

      if (sql.includes("FROM app.users u") && sql.includes("u.id = $2")) {
        const tid = params[0] as string;
        const uid = params[1] as string;
        const u = managerUsers.find((m) => m.user_id === uid);
        return rows(u && tid === TENANT ? [{ id: u.user_id, email: u.email, full_name: u.full_name }] : []);
      }

      // ── per-vehicle breakdown ───────────────────────────────────────────────────────────────
      if (sql.includes("FROM app.vehicles v") && sql.includes("AS vehicle_id")) {
        const visible = vehicles.filter((v) => v.tenant_id === tenantId && inVehicleScope(v.id));
        return rows(
          visible.map((v) => ({
            vehicle_id: v.id,
            plate: v.plate,
            distance_km: String(
              shifts.filter((s) => s.vehicle_id === v.id).reduce((a, s) => a + s.distance, 0),
            ),
            fuel_cost: String(
              fuelPurchases.filter((f) => f.vehicle_id === v.id).reduce((a, f) => a + f.cost, 0),
            ),
            active_days: String(new Set(shifts.filter((s) => s.vehicle_id === v.id).map((s) => s.day)).size),
            anomalies: String(anomalies.filter((a) => a.vehicle_id === v.id).length),
          })),
        );
      }

      // ── per-driver breakdown ────────────────────────────────────────────────────────────────
      if (sql.includes("FROM app.drivers d") && sql.includes("AS driver_id")) {
        const visible = drivers.filter((d) => d.tenant_id === tenantId && inDriverScope(d.id));
        return rows(
          visible.map((d) => ({
            driver_id: d.id,
            name: d.name,
            distance_km: String(
              shifts.filter((s) => s.driver_id === d.id).reduce((a, s) => a + s.distance, 0),
            ),
            shifts: String(shifts.filter((s) => s.driver_id === d.id).length),
            anomalies: String(anomalies.filter((a) => a.driver_id === d.id).length),
          })),
        );
      }

      // ── KPI / legacy-counter roll-ups (single row of scalar subqueries) ─────────────────────
      if (sql.includes("AS vehicles") || sql.includes("AS active_fleet")) {
        const vRows = vehicles.filter((v) => v.tenant_id === tenantId && inVehicleScope(v.id));
        const dRows = drivers.filter((d) => d.tenant_id === tenantId && inDriverScope(d.id));
        const sRows = shifts.filter((s) => s.tenant_id === tenantId && either(s.vehicle_id, s.driver_id));
        const fRows = fuelPurchases.filter((f) => f.tenant_id === tenantId && either(f.vehicle_id, f.driver_id));
        const aRows = anomalies.filter((a) => either(a.vehicle_id, a.driver_id));

        const fuel = String(fRows.reduce((acc, f) => acc + f.cost, 0));
        return rows([
          {
            vehicles: String(vRows.length),
            drivers: String(dRows.length),
            distance_km: String(sRows.reduce((acc, s) => acc + s.distance, 0)),
            fuel_cost: fuel,
            anomalies: String(aRows.length),
            active_fleet: String(vRows.length),
            open_accidents: "0",
            pending_dvir: "0",
            expiring_docs: "0",
            fuel_spend_30d: fuel,
            anomalies_open: String(aRows.length),
          },
        ]);
      }

      return rows([]);
    },
  } as unknown as DbClient & { calls: Recorded[] };

  return client;
}

function rows(data: Record<string, unknown>[]) {
  return { rows: data as never, rowCount: data.length, command: "SELECT", fields: [], oid: 0, rowAsArray: false };
}

function principal(overrides: Partial<Principal>): Principal {
  return {
    userId: U_ADMIN,
    tenantId: TENANT,
    email: "admin@acme.test",
    roles: ["ADMIN"],
    permissions: new Set(),
    locale: "en",
    ...overrides,
  } as Principal;
}

const RANGE = resolveRange({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" });

// ── resolveScope ────────────────────────────────────────────────────────────────────────────────

describe("resolveScope", () => {
  it("gives an ADMIN the whole tenant", async () => {
    const scope = await resolveScope(fakeClient(), principal({ roles: ["ADMIN"] }));
    expect(scope).toEqual({
      tenant_id: TENANT,
      vehicle_ids: null,
      driver_ids: null,
      isCompanyAdmin: true,
    });
  });

  it("narrows a FLEET_MANAGER to their assigned vehicles", async () => {
    const scope = await resolveScope(
      fakeClient(),
      principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }),
    );
    expect(scope.isCompanyAdmin).toBe(false);
    expect(scope.vehicle_ids).toEqual([V1, V2]);
    // Scoped on the vehicle axis only, so the driver axis stays unrestricted.
    expect(scope.driver_ids).toBeNull();
  });

  it("fails closed for a FLEET_MANAGER with no assignments", async () => {
    const scope = await resolveScope(
      fakeClient(),
      principal({ userId: U_MANAGER_UNASSIGNED, roles: ["FLEET_MANAGER"] }),
    );
    // Empty arrays, NOT null: an unscoped manager sees nothing rather than everything.
    expect(scope.vehicle_ids).toEqual([]);
    expect(scope.driver_ids).toEqual([]);
    expect(scope.isCompanyAdmin).toBe(false);
  });

  it("pins a DRIVER to their own driver row", async () => {
    const scope = await resolveScope(
      fakeClient(),
      principal({ userId: U_DRIVER1, roles: ["DRIVER"] }),
    );
    expect(scope.driver_ids).toEqual([D1]);
    expect(scope.isCompanyAdmin).toBe(false);
  });

  it("treats SYSTEM_ADMIN as a company admin", async () => {
    const scope = await resolveScope(fakeClient(), principal({ roles: ["SYSTEM_ADMIN"] }));
    expect(scope.isCompanyAdmin).toBe(true);
    expect(scope.vehicle_ids).toBeNull();
  });
});

// ── Company view ────────────────────────────────────────────────────────────────────────────────

describe("AnalyticsService.company", () => {
  it("ADMIN sees company-wide totals and every manager row", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ roles: ["ADMIN"] }));

    const result = await svc.company(scope, RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value as {
      kpis: { vehicles: number; distanceKm: number; fuelCost: number };
      managers: { user_id: string; assignedVehicleIds: string[] | null; kpis: { fuelCost: number } }[];
      active_fleet: number;
      fuel_spend_30d: number;
    };

    // Three vehicles in TENANT; the OTHER_TENANT vehicle is excluded by the tenant filter.
    expect(body.kpis.vehicles).toBe(3);
    expect(body.kpis.distanceKm).toBe(120 + 80 + 200 + 500);
    expect(body.kpis.fuelCost).toBe(100 + 250 + 900);
    expect(body.active_fleet).toBe(3);
    expect(body.fuel_spend_30d).toBe(1250);

    // The per-manager rows are each scored against that manager's OWN scope.
    const mia = body.managers.find((m) => m.user_id === U_MANAGER);
    expect(mia?.assignedVehicleIds).toEqual([V1, V2]);
    expect(mia?.kpis.fuelCost).toBe(350); // V1 + V2 only, never V3

    const newt = body.managers.find((m) => m.user_id === U_MANAGER_UNASSIGNED);
    expect(newt?.assignedVehicleIds).toEqual([]);
    expect(newt?.kpis.fuelCost).toBe(0);
  });

  it("FLEET_MANAGER sees only their assigned vehicles", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }));

    const result = await svc.company(scope, RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value as { kpis: { vehicles: number; fuelCost: number; distanceKm: number } };

    expect(body.kpis.vehicles).toBe(2); // V1 + V2, not V3
    expect(body.kpis.fuelCost).toBe(350); // V3's 900 is excluded
    expect(body.kpis.distanceKm).toBe(400); // V3's 500 is excluded

    // The scope really did reach the SQL as a bound id array.
    const scoped = client.calls.filter((c) => c.params.some((p) => Array.isArray(p) && p.includes(V1)));
    expect(scoped.length).toBeGreaterThan(0);
    expect(client.calls.some((c) => c.params.some((p) => Array.isArray(p) && p.includes(V3)))).toBe(false);
  });

  it("an unassigned FLEET_MANAGER sees zeros, not the company", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(
      client,
      principal({ userId: U_MANAGER_UNASSIGNED, roles: ["FLEET_MANAGER"] }),
    );

    const result = await svc.company(scope, RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value as { kpis: { vehicles: number; fuelCost: number; distanceKm: number } };
    expect(body.kpis.vehicles).toBe(0);
    expect(body.kpis.fuelCost).toBe(0);
    expect(body.kpis.distanceKm).toBe(0);
  });
});

// ── Manager / vehicle / driver drill-down ───────────────────────────────────────────────────────

describe("AnalyticsService.manager", () => {
  it("expands a manager's slice per vehicle and per driver for an ADMIN", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const admin = await resolveScope(client, principal({ roles: ["ADMIN"] }));

    const result = await svc.manager(admin, U_ADMIN, U_MANAGER, RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value as {
      assignedVehicleIds: string[] | null;
      vehicles: { vehicle_id: string; utilisationPct: number }[];
      kpis: { fuelCost: number };
    };

    expect(body.assignedVehicleIds).toEqual([V1, V2]);
    expect(body.vehicles.map((v) => v.vehicle_id).sort()).toEqual([V1, V2]);
    expect(body.kpis.fuelCost).toBe(350);
    // V1 was driven on 2 distinct days of a 31-day window.
    const v1 = body.vehicles.find((v) => v.vehicle_id === V1);
    expect(v1?.utilisationPct).toBeCloseTo(6.5, 1);
  });

  it("lets a manager read their own analytics", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }));

    const result = await svc.manager(scope, U_MANAGER, U_MANAGER, RANGE);
    expect(result.ok).toBe(true);
  });

  it("refuses one manager reading another", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }));

    const result = await svc.manager(scope, U_MANAGER, U_MANAGER_UNASSIGNED, RANGE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.httpStatus).toBe(403);
  });
});

describe("AnalyticsService.vehicle", () => {
  it("returns KPIs for a vehicle inside the caller's scope", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }));

    const result = await svc.vehicle(scope, V1, RANGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value as { vehicle: { vehicle_id: string; distanceKm: number; fuelCost: number } };
    expect(body.vehicle.vehicle_id).toBe(V1);
    expect(body.vehicle.distanceKm).toBe(200);
    expect(body.vehicle.fuelCost).toBe(100);
  });

  it("refuses a vehicle outside the manager's scope", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_MANAGER, roles: ["FLEET_MANAGER"] }));

    const result = await svc.vehicle(scope, V3, RANGE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.httpStatus).toBe(403);
  });

  it("404s a vehicle belonging to another tenant", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ roles: ["ADMIN"] }));

    const result = await svc.vehicle(scope, "dddddddd-0000-0000-0000-00000000000f", RANGE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.httpStatus).toBe(404);
  });
});

describe("AnalyticsService.driver", () => {
  it("DRIVER sees only their own numbers", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope = await resolveScope(client, principal({ userId: U_DRIVER1, roles: ["DRIVER"] }));

    const own = await svc.driver(scope, D1, RANGE);
    expect(own.ok).toBe(true);
    if (own.ok) {
      const body = own.value as { driver: { driver_id: string; distanceKm: number; shifts: number } };
      expect(body.driver.driver_id).toBe(D1);
      expect(body.driver.distanceKm).toBe(200);
      expect(body.driver.shifts).toBe(2);
    }

    // …and cannot reach a colleague.
    const other = await svc.driver(scope, D2, RANGE);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.httpStatus).toBe(403);
  });

  it("resolves the driver row backing /analytics/me", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    await expect(svc.driverIdForUser(TENANT, U_DRIVER1)).resolves.toBe(D1);
    await expect(svc.driverIdForUser(TENANT, U_ADMIN)).resolves.toBeNull();
  });

  it("ADMIN can read any driver in the tenant", async () => {
    const client = fakeClient();
    const svc = new AnalyticsService(client);
    const scope: ResolvedScope = await resolveScope(client, principal({ roles: ["ADMIN"] }));

    const result = await svc.driver(scope, D2, RANGE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body = result.value as { driver: { driver_id: string; distanceKm: number } };
      expect(body.driver.driver_id).toBe(D2);
      expect(body.driver.distanceKm).toBe(700);
    }
  });
});
