// packages/api/test/admin.management.test.ts
// The admin-management surface the mobile client binds to (packages/mobile/BACKEND_TODO.md):
// GET /admin/managers, POST /admin/managers/{id}/assign, POST /vehicles.
//
// These run against an in-memory fake DbClient that speaks just enough SQL to model the three
// tables involved (app.users + roles + manager_assignments + vehicles) INCLUDING tenant filtering,
// so the real repositories and services are exercised — only the driver is faked. That is what
// lets the cross-tenant assertion mean something: the fake honours `tenant_id = $n` exactly as the
// repository passes it, which is the defence-in-depth filter that must hold even if RLS is absent.

import { TenancyService, toAdminSummary } from "../src/services/tenancy";
import { VehicleService, toVehicleRecord, DEFAULT_FUEL_TANK_CAPACITY_LITRES } from "../src/services/vehicles";
import { TenantUserRepository, ManagerAssignmentRepository, UserTenantRepository } from "../src/repositories/tenancy";
import { VehicleRepository, AssignmentRepository } from "../src/repositories/shifts";
import { DriverRepository } from "../src/repositories/identity";
import type { DbClient, UserRow, VehicleRow } from "@fleet/shared";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

const ADMIN_A = "aaaaaaaa-0000-0000-0000-000000000001";
const MANAGER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const VEHICLE_A1 = "cccccccc-0000-0000-0000-000000000001";
const VEHICLE_A2 = "cccccccc-0000-0000-0000-000000000002";
const DRIVER_A1 = "dddddddd-0000-0000-0000-000000000001";
const DRIVER_A1_USER = "dddddddd-0000-0000-0000-0000000000f1";

interface Db {
  users: Array<{ id: string; tenant_id: string; email: string; full_name: string | null; is_active: boolean }>;
  roles: Array<{ user_id: string; role_code: string }>;
  assignments: Array<{ tenant_id: string; user_id: string; vehicle_id: string | null; driver_id: string | null }>;
  vehicles: Array<Partial<VehicleRow> & { id: string; tenant_id: string; license_plate: string }>;
  drivers: Array<{ id: string; user_id: string; tenant_id: string }>;
}

function seed(): Db {
  return {
    users: [
      { id: ADMIN_A, tenant_id: TENANT_A, email: "admin@a.co.ke", full_name: "Admin A", is_active: true },
      { id: MANAGER_A, tenant_id: TENANT_A, email: "mgr@a.co.ke", full_name: "Manager A", is_active: true },
    ],
    roles: [
      { user_id: ADMIN_A, role_code: "ADMIN" },
      { user_id: MANAGER_A, role_code: "FLEET_MANAGER" },
    ],
    assignments: [{ tenant_id: TENANT_A, user_id: MANAGER_A, vehicle_id: VEHICLE_A1, driver_id: null }],
    vehicles: [
      { id: VEHICLE_A1, tenant_id: TENANT_A, license_plate: "KAA 001A", fuel_tank_capacity_litres: "300.00" },
      { id: VEHICLE_A2, tenant_id: TENANT_A, license_plate: "KAA 002A", fuel_tank_capacity_litres: "300.00" },
    ],
    drivers: [{ id: DRIVER_A1, user_id: DRIVER_A1_USER, tenant_id: TENANT_A }],
  };
}

/**
 * Minimal SQL interpreter. It matches on the distinctive fragment of each statement the
 * repositories issue rather than parsing SQL, and it always applies the tenant parameter the
 * repository supplied — never an implicit "current tenant" — so a missing filter would show up as
 * a leaked row.
 */
function fakeClient(db: Db): DbClient {
  let vehicleSeq = 0;
  return {
    async query<T = unknown>(text: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number | null }> {
      const sql = text.replace(/\s+/g, " ").trim();
      const rows = (r: unknown[]) => ({ rows: r as T[], rowCount: r.length });

      // TenantUserRepository.listUsers
      if (sql.includes("FROM app.users u") && sql.includes("JOIN app.user_tenants ut")) {
        const [tenantId] = params as [string];
        const out = db.users
          .filter((u) => u.tenant_id === tenantId)
          .sort((a, b) => a.email.localeCompare(b.email))
          .map((u) => ({
            id: u.id,
            email: u.email,
            full_name: u.full_name,
            phone: null,
            is_active: u.is_active,
            mfa_enabled: false,
            locale: "en",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            last_login_at: null,
            role_codes: db.roles.filter((r) => r.user_id === u.id).map((r) => r.role_code),
            vehicle_ids: db.assignments
              .filter((a) => a.user_id === u.id && a.tenant_id === tenantId && a.vehicle_id)
              .map((a) => a.vehicle_id),
            driver_ids: db.assignments
              .filter((a) => a.user_id === u.id && a.tenant_id === tenantId && a.driver_id)
              .map((a) => a.driver_id),
          }));
        return rows(out);
      }

      // UserTenantRepository.isMember
      if (sql.startsWith("SELECT 1 FROM app.user_tenants")) {
        const [userId, tenantId] = params as [string, string];
        return rows(db.users.filter((u) => u.id === userId && u.tenant_id === tenantId).map(() => ({})));
      }

      // ManagerAssignmentRepository.replaceVehicles / replaceDrivers (DELETE halves)
      if (sql.startsWith("DELETE FROM app.manager_assignments")) {
        const [tenantId, userId, keep] = params as [string, string, string[]];
        const isVehicle = sql.includes("vehicle_id IS NOT NULL");
        db.assignments = db.assignments.filter((a) => {
          if (a.tenant_id !== tenantId || a.user_id !== userId) return true;
          if (isVehicle ? !a.vehicle_id : !a.driver_id) return true;
          if (isVehicle) return keep.includes(a.vehicle_id!);
          // Driver ids resolve through app.drivers on id OR user_id.
          const resolved = db.drivers
            .filter((d) => d.tenant_id === tenantId && (keep.includes(d.id) || keep.includes(d.user_id)))
            .map((d) => d.id);
          return resolved.includes(a.driver_id!);
        });
        return rows([]);
      }

      // ManagerAssignmentRepository.linkVehiclesToVehicleOperators (additive widening)
      if (sql.includes("INSERT INTO app.manager_assignments") && sql.includes("SELECT DISTINCT")) {
        const [tenantId, vehicleId, linkedIds] = params as [string, string, string[]];
        const owners = db.assignments
          .filter((a) => a.tenant_id === tenantId && a.vehicle_id === vehicleId)
          .map((a) => a.user_id);
        for (const userId of new Set(owners)) {
          for (const v of db.vehicles) {
            if (!linkedIds.includes(v.id) || v.tenant_id !== tenantId) continue;
            if (db.assignments.some((a) => a.user_id === userId && a.vehicle_id === v.id)) continue;
            db.assignments.push({ tenant_id: tenantId, user_id: userId, vehicle_id: v.id, driver_id: null });
          }
        }
        return rows([]);
      }

      // ManagerAssignmentRepository.replaceVehicles (INSERT half)
      if (sql.includes("INSERT INTO app.manager_assignments") && sql.includes("FROM app.vehicles v")) {
        const [tenantId, userId, ids, ,] = params as [string, string, string[], string];
        for (const v of db.vehicles) {
          if (!ids.includes(v.id) || v.tenant_id !== tenantId) continue;
          if (db.assignments.some((a) => a.user_id === userId && a.vehicle_id === v.id)) continue;
          db.assignments.push({ tenant_id: tenantId, user_id: userId, vehicle_id: v.id, driver_id: null });
        }
        return rows([]);
      }

      // ManagerAssignmentRepository.replaceDrivers (INSERT half)
      if (sql.includes("INSERT INTO app.manager_assignments") && sql.includes("FROM app.drivers d")) {
        const [tenantId, userId, ids] = params as [string, string, string[]];
        for (const d of db.drivers) {
          if (d.tenant_id !== tenantId) continue;
          if (!ids.includes(d.id) && !ids.includes(d.user_id)) continue;
          if (db.assignments.some((a) => a.user_id === userId && a.driver_id === d.id)) continue;
          db.assignments.push({ tenant_id: tenantId, user_id: userId, vehicle_id: null, driver_id: d.id });
        }
        return rows([]);
      }

      // ManagerAssignmentRepository.listForUser
      if (sql.startsWith("SELECT * FROM app.manager_assignments")) {
        const [tenantId, userId] = params as [string, string];
        return rows(db.assignments.filter((a) => a.tenant_id === tenantId && a.user_id === userId));
      }

      // VehicleRepository.findByPlateForTenant
      if (sql.includes("FROM app.vehicles") && sql.includes("license_plate = $2")) {
        const [tenantId, plate] = params as [string, string];
        return rows(db.vehicles.filter((v) => v.tenant_id === tenantId && v.license_plate === plate));
      }

      // VehicleRepository.findByIdForTenant
      if (sql.includes("FROM app.vehicles") && sql.includes("id = $1 AND tenant_id = $2")) {
        const [id, tenantId] = params as [string, string];
        return rows(db.vehicles.filter((v) => v.id === id && v.tenant_id === tenantId));
      }

      // VehicleRepository.listByTenant
      if (sql.includes("FROM app.vehicles") && sql.includes("ORDER BY created_at DESC")) {
        const [tenantId, , , limit] = params as [string, unknown, unknown, number];
        return rows(db.vehicles.filter((v) => v.tenant_id === tenantId).slice(0, limit));
      }

      // VehicleRepository.createForTenant
      if (sql.startsWith("INSERT INTO app.vehicles")) {
        const [tenantId, plate, vclass, make, model, year, ownership, tank, notes] = params as [
          string, string, string | null, string | null, string | null, number | null, string | null, number, string | null,
        ];
        vehicleSeq += 1;
        const row = {
          id: `eeeeeeee-0000-0000-0000-00000000000${vehicleSeq}`,
          tenant_id: tenantId,
          license_plate: plate,
          vehicle_class: vclass ?? "TRACTOR",
          make,
          model,
          year,
          ownership_type: ownership ?? "OWNED",
          fuel_tank_capacity_litres: String(tank),
          notes,
          tracker_imei: null,
          status: "AVAILABLE",
          is_operational: true,
          current_odometer_km: 0,
          created_at: "2026-01-01T00:00:00.000Z",
        };
        db.vehicles.push(row as never);
        return rows([row]);
      }

      // VehicleRepository.filterIdsInTenant
      if (sql.includes("SELECT id FROM app.vehicles")) {
        const [tenantId, ids] = params as [string, string[]];
        return rows(db.vehicles.filter((v) => v.tenant_id === tenantId && ids.includes(v.id)).map((v) => ({ id: v.id })));
      }

      // DriverRepository.resolveIdsInTenant
      if (sql.includes("SELECT id FROM app.drivers")) {
        const [tenantId, ids] = params as [string, string[]];
        return rows(
          db.drivers
            .filter((d) => d.tenant_id === tenantId && (ids.includes(d.id) || ids.includes(d.user_id)))
            .map((d) => ({ id: d.id })),
        );
      }

      // app.assignments writes (vehicle → driver dispatch); not asserted here.
      if (sql.includes("app.assignments")) return rows([]);

      throw new Error(`fakeClient: unhandled SQL: ${sql.slice(0, 120)}`);
    },
  };
}

function makeTenancy(client: DbClient): TenancyService {
  // Only the collaborators these flows touch are real (membership, manager scope, the tenant-user
  // read model); the invite/email/role paths are never reached from here.
  return new TenancyService(
    {} as never,
    {} as never,
    new UserTenantRepository(client),
    {} as never,
    new ManagerAssignmentRepository(client),
    new TenantUserRepository(client),
    {} as never,
    {} as never,
    "https://console.test",
  );
}

function makeVehicles(client: DbClient): VehicleService {
  return new VehicleService(
    new VehicleRepository(client),
    new DriverRepository(client),
    new AssignmentRepository(client),
    new ManagerAssignmentRepository(client),
  );
}

describe("GET /admin/managers", () => {
  it("returns the tenant's admins/managers with their assigned ids", async () => {
    const db = seed();
    const svc = makeTenancy(fakeClient(db));

    const result = await svc.listManagers({
      tenantId: TENANT_A,
      callerUserId: ADMIN_A,
      callerRoles: ["ADMIN"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);

    const manager = result.value.find((m) => m.user_id === MANAGER_A)!;
    expect(manager).toEqual({
      user_id: MANAGER_A,
      email: "mgr@a.co.ke",
      full_name: "Manager A",
      roles: ["FLEET_MANAGER"],
      status: "ACTIVE",
      assigned_vehicle_ids: [VEHICLE_A1],
      assigned_driver_ids: [],
    });
  });

  it("shows a FLEET_MANAGER only themselves", async () => {
    const db = seed();
    const svc = makeTenancy(fakeClient(db));

    const result = await svc.listManagers({
      tenantId: TENANT_A,
      callerUserId: MANAGER_A,
      callerRoles: ["FLEET_MANAGER"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((m) => m.user_id)).toEqual([MANAGER_A]);
  });

  it("never returns another tenant's users", async () => {
    const db = seed();
    db.users.push({ id: "bbbb0000-0000-0000-0000-000000000001", tenant_id: TENANT_B, email: "admin@b.co.ke", full_name: "Admin B", is_active: true });
    db.roles.push({ user_id: "bbbb0000-0000-0000-0000-000000000001", role_code: "ADMIN" });
    const svc = makeTenancy(fakeClient(db));

    const result = await svc.listManagers({ tenantId: TENANT_A, callerUserId: ADMIN_A, callerRoles: ["ADMIN"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((m) => m.email)).not.toContain("admin@b.co.ke");
  });

  it("maps a suspended account to SUSPENDED", () => {
    const summary = toAdminSummary({
      user: { id: ADMIN_A, email: "x@y.z", full_name: null, is_active: false } as unknown as UserRow,
      roles: ["ADMIN"],
      vehicle_ids: [],
      driver_ids: [],
    });
    expect(summary.status).toBe("SUSPENDED");
    expect(summary.full_name).toBeNull();
  });
});

describe("POST /admin/managers/{id}/assign", () => {
  it("writes manager_assignments with replace semantics", async () => {
    const db = seed();
    const svc = makeTenancy(fakeClient(db));

    const result = await svc.assign({
      tenantId: TENANT_A,
      userId: MANAGER_A,
      vehicleIds: [VEHICLE_A2],
      driverIds: [DRIVER_A1],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vehicle_ids).toEqual([VEHICLE_A2]);
    expect(result.value.driver_ids).toEqual([DRIVER_A1]);

    // Replace, not append: the previously assigned VEHICLE_A1 row is gone.
    const forManager = db.assignments.filter((a) => a.user_id === MANAGER_A);
    expect(forManager.filter((a) => a.vehicle_id).map((a) => a.vehicle_id)).toEqual([VEHICLE_A2]);
    expect(forManager.filter((a) => a.driver_id).map((a) => a.driver_id)).toEqual([DRIVER_A1]);
  });

  it("accepts a driver's user_id, which is what the mobile picker sends", async () => {
    const db = seed();
    const svc = makeTenancy(fakeClient(db));

    // The roster picker is seeded from GET /drivers, whose rows are keyed by users.id.
    const result = await svc.assign({
      tenantId: TENANT_A,
      userId: MANAGER_A,
      vehicleIds: [],
      driverIds: [DRIVER_A1_USER],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(true);
    // It is stored as the drivers.id the FK requires.
    expect(db.assignments.filter((a) => a.driver_id).map((a) => a.driver_id)).toEqual([DRIVER_A1]);
  });

  it("clears a dimension when given an empty array", async () => {
    const db = seed();
    const svc = makeTenancy(fakeClient(db));

    await svc.assign({ tenantId: TENANT_A, userId: MANAGER_A, vehicleIds: [], driverIds: [], actorUserId: ADMIN_A });

    expect(db.assignments.filter((a) => a.user_id === MANAGER_A)).toEqual([]);
  });

  it("rejects a target user in another tenant (the IDOR guard)", async () => {
    const db = seed();
    db.users.push({ id: "bbbb0000-0000-0000-0000-000000000009", tenant_id: TENANT_B, email: "mgr@b.co.ke", full_name: "Mgr B", is_active: true });
    const svc = makeTenancy(fakeClient(db));

    const result = await svc.assign({
      tenantId: TENANT_A,
      userId: "bbbb0000-0000-0000-0000-000000000009",
      vehicleIds: [VEHICLE_A1],
      driverIds: [],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.httpStatus).toBe(404);
    expect(db.assignments.some((a) => a.user_id === "bbbb0000-0000-0000-0000-000000000009")).toBe(false);
  });
});

describe("POST /vehicles", () => {
  it("creates a vehicle bound to the caller's tenant, invisible to another tenant", async () => {
    const db = seed();
    const client = fakeClient(db);
    const svc = makeVehicles(client);

    const created = await svc.create({ tenantId: TENANT_A, licensePlate: "KBB 123C", make: "Isuzu", model: "FRR" });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.license_plate).toBe("KBB 123C");
    expect(created.value.status).toBe("AVAILABLE");
    expect(created.value.is_operational).toBe(true);

    // Visible inside its own tenant …
    const own = await svc.get(TENANT_A, created.value.id);
    expect(own.ok).toBe(true);

    // … and a 404 (never another tenant's row) from outside it.
    const other = await svc.get(TENANT_B, created.value.id);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.httpStatus).toBe(404);

    // The list for the other tenant does not contain it either.
    const otherList = await svc.list({ tenantId: TENANT_B, limit: 50 });
    expect(otherList.ok).toBe(true);
    if (!otherList.ok) return;
    expect(otherList.value).toEqual([]);
  });

  it("normalises the plate and rejects a duplicate within the tenant with 409", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    // Seeded as "KAA 001A"; the plate is upper-cased and trimmed before the uniqueness check.
    const dup = await svc.create({ tenantId: TENANT_A, licensePlate: "  kaa 001a  " });

    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.httpStatus).toBe(409);
    expect(dup.error.error_code).toBe("VEHICLE_PLATE_EXISTS");
  });

  it("allows the same plate in a different tenant", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    const created = await svc.create({ tenantId: TENANT_B, licensePlate: "KAA 001A" });

    expect(created.ok).toBe(true);
  });

  it("substitutes the placeholder tank capacity the NOT NULL column requires", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    const created = await svc.create({ tenantId: TENANT_A, licensePlate: "KCC 900Z" });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.fuel_tank_capacity_litres).toBe(DEFAULT_FUEL_TANK_CAPACITY_LITRES);
  });
});

describe("POST /vehicles/{id}/assign", () => {
  it("rejects a self-link", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    const result = await svc.assign({
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A1,
      driverIds: [],
      vehicleIds: [VEHICLE_A1],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.httpStatus).toBe(400);
  });

  it("rejects a driver from another tenant instead of silently dropping it", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    const result = await svc.assign({
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A1,
      driverIds: ["ffffffff-0000-0000-0000-000000000009"],
      vehicleIds: [],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.httpStatus).toBe(409);
    expect(result.error.error_code).toBe("DRIVER_NOT_IN_TENANT");
  });

  it("404s on a target vehicle outside the caller's tenant", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    const result = await svc.assign({
      tenantId: TENANT_B,
      vehicleId: VEHICLE_A1,
      driverIds: [],
      vehicleIds: [],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.httpStatus).toBe(404);
  });

  it("widens the scope of managers already assigned to the target vehicle", async () => {
    const db = seed();
    const svc = makeVehicles(fakeClient(db));

    // MANAGER_A is seeded as an operator of VEHICLE_A1; linking A2 must reach them additively.
    const result = await svc.assign({
      tenantId: TENANT_A,
      vehicleId: VEHICLE_A1,
      driverIds: [],
      vehicleIds: [VEHICLE_A2],
      actorUserId: ADMIN_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vehicle_ids).toEqual([VEHICLE_A2]);

    // Additive: the original VEHICLE_A1 scope survives and VEHICLE_A2 is added alongside it.
    const scope = db.assignments
      .filter((a) => a.user_id === MANAGER_A && a.vehicle_id)
      .map((a) => a.vehicle_id)
      .sort();
    expect(scope).toEqual([VEHICLE_A1, VEHICLE_A2].sort());
  });
});

describe("toVehicleRecord", () => {
  it("normalises PG numeric text to numbers for the mobile schema", () => {
    const record = toVehicleRecord({
      id: VEHICLE_A1,
      license_plate: "KAA 001A",
      vehicle_class: "TRACTOR",
      status: "AVAILABLE",
      is_operational: true,
      non_operational_reason: null,
      make: "Isuzu",
      model: "FRR",
      year: 2021,
      ownership_type: "OWNED",
      current_odometer_km: 1234,
      current_odometer_at: null,
      engine_hours: "980.5",
      fuel_tank_capacity_litres: "300.00",
      notes: null,
    } as unknown as VehicleRow);

    expect(record.fuel_tank_capacity_litres).toBe(300);
    expect(record.engine_hours).toBe(980.5);
    expect(record.current_odometer_km).toBe(1234);
  });
});
