// packages/api/src/services/analytics.ts
// Scope-aware hierarchical analytics (the `/analytics/*` surface, aliased at `/reports/*`).
//
// Three rules hold for every query in this file:
//   1. READ ONLY. Nothing here mutates, so it runs on a pooled client via withTenantClient (D8).
//   2. TENANT FILTERED TWICE. RLS binds `app.current_tenant_id` for the transaction, and every
//      statement ALSO carries an explicit `tenant_id = $1`. The redundancy is deliberate (the same
//      defence-in-depth the tenancy repositories use): a connection borrowed without the GUC still
//      cannot cross a company boundary.
//   3. SCOPE FILTERED. On top of the tenant, the caller's ResolvedScope narrows the rows to the
//      vehicles/drivers they were assigned. `null` on a dimension means unrestricted, an EMPTY
//      array means nothing — so an unassigned FLEET_MANAGER gets zeros, not the whole company.
//
// Money and distance arrive from PG as strings (numeric); every one is coerced through `num()` so
// the JSON body carries real numbers and matches the mobile zod schemas.

import { Forbidden, NotFound, err, ok, type DbClient, type Result } from "@fleet/shared";
import { type ResolvedScope, scopeFromAssignmentRows } from "./scope";

/** Postgres `numeric`/`bigint` arrive as strings; the API contract is numbers. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

/** Defaults to the trailing 30 days, which is what the mobile `fuel_spend_30d` counter expects. */
export function resolveRange(input?: { from?: string; to?: string }): AnalyticsRange {
  const to = input?.to ? new Date(input.to) : new Date();
  const from = input?.from ? new Date(input.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

interface AnalyticsKpis {
  vehicles: number;
  drivers: number;
  distanceKm: number;
  fuelCost: number;
  anomalies: number;
}

interface VehicleAnalytics {
  vehicle_id: string;
  plate: string | null;
  distanceKm: number;
  fuelCost: number;
  utilisationPct: number;
  anomalies: number;
}

interface DriverAnalytics {
  driver_id: string;
  name: string | null;
  distanceKm: number;
  shifts: number;
  anomalies: number;
}

interface ManagerAnalyticsSummary {
  user_id: string;
  full_name: string | null;
  email: string;
  assignedVehicleIds: string[] | null;
  assignedDriverIds: string[] | null;
  kpis: AnalyticsKpis;
}

/**
 * A scope compiled into SQL fragments.
 *
 * Each dimension becomes either the literal `TRUE` (unrestricted) or an `= ANY($n)` test. Building
 * them once per query keeps the placeholder numbering honest and means an empty array naturally
 * matches nothing, which is exactly the "unassigned manager sees zero" behaviour we want.
 */
class ScopeSql {
  readonly params: unknown[] = [];

  constructor(private readonly scope: ResolvedScope) {
    this.params.push(scope.tenant_id);
  }

  /** `$1` is always the tenant id. */
  get tenantParam(): string {
    return "$1";
  }

  private bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Narrows a vehicle-id column to the caller's vehicle scope. */
  vehicle(column: string): string {
    if (this.scope.vehicle_ids === null) return "TRUE";
    return `${column} = ANY(${this.bind(this.scope.vehicle_ids)}::uuid[])`;
  }

  /** Narrows a driver-id column to the caller's driver scope. */
  driver(column: string): string {
    if (this.scope.driver_ids === null) return "TRUE";
    return `${column} = ANY(${this.bind(this.scope.driver_ids)}::uuid[])`;
  }

  /**
   * Rows that carry both a vehicle and a driver (shifts, fuel purchases, anomalies) are visible
   * when EITHER dimension matches. A manager assigned a vehicle should see that vehicle's activity
   * whoever drove it, and a manager assigned a driver should follow that driver across vehicles.
   *
   * The predicate is `TRUE` ONLY when BOTH dimensions are unrestricted. If exactly one dimension is
   * restricted, the other is inherited in full, so we return the single restricted predicate — that
   * is what keeps a vehicle-scoped FLEET_MANAGER (driver_ids = null) and a DRIVER (vehicle_ids = null)
   * from silently collapsing to the whole company. `ScopeSql.vehicle/driver` already return "TRUE"
   * when their own axis is unrestricted, so this check reads that signal correctly.
   */
  either(vehicleColumn: string, driverColumn: string): string {
    const v = this.vehicle(vehicleColumn);
    const d = this.driver(driverColumn);
    if (v === "TRUE" && d === "TRUE") return "TRUE";
    if (v === "TRUE") return d; // driver axis restricts, vehicle axis open
    if (d === "TRUE") return v; // vehicle axis restricts, driver axis open
    return `(${v} OR ${d})`;
  }

  add(value: unknown): string {
    return this.bind(value);
  }
}

export class AnalyticsService {
  constructor(private readonly client: DbClient) {}

  /**
   * `GET /analytics/company`. The company roll-up plus one row per FLEET_MANAGER, each already
   * reduced to that manager's own assignment scope — this is the hierarchical view an ADMIN drills
   * down from. The flat `active_fleet` / `fuel_spend_30d` counters mirror the mobile
   * `AnalyticsReportSchema` so `GET /reports/analytics` parses unchanged.
   */
  async company(scope: ResolvedScope, range: AnalyticsRange): Promise<Result<unknown>> {
    const kpis = await this.kpisFor(scope, range);
    const managers = await this.managerSummaries(scope, range);
    const legacy = await this.legacyCounters(scope, range);

    return ok({
      tenant_id: scope.tenant_id,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      kpis,
      managers,
      ...legacy,
    });
  }

  /**
   * `GET /analytics/manager/{userId}`. Authorised for an ADMIN of the tenant, or for the manager
   * themselves. The figures are computed from the TARGET's assignment scope, not the caller's, so
   * an ADMIN sees exactly what that manager sees.
   */
  async manager(
    caller: ResolvedScope,
    callerUserId: string,
    targetUserId: string,
    range: AnalyticsRange,
  ): Promise<Result<unknown>> {
    if (!caller.isCompanyAdmin && callerUserId !== targetUserId) {
      return err(new Forbidden("You may only view your own manager analytics"));
    }

    const userRes = await this.client.query<{ id: string; email: string | null; full_name: string | null }>(
      `SELECT u.id, u.email, u.full_name
         FROM app.users u
         JOIN app.user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
        WHERE u.id = $2 AND u.deleted_at IS NULL
        LIMIT 1`,
      [caller.tenant_id, targetUserId],
    );
    const user = userRes.rows[0];
    if (!user) return err(new NotFound("User not found in this tenant"));

    const target = await this.scopeOfManager(caller.tenant_id, targetUserId);
    const [kpis, vehicles, drivers] = await Promise.all([
      this.kpisFor(target, range),
      this.vehicleBreakdown(target, range),
      this.driverBreakdown(target, range),
    ]);

    return ok({
      user_id: user.id,
      full_name: user.full_name,
      email: user.email ?? "",
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      assignedVehicleIds: target.vehicle_ids,
      assignedDriverIds: target.driver_ids,
      kpis,
      vehicles,
      drivers,
    });
  }

  /** `GET /analytics/vehicle/{vehicleId}`. Tenant-checked, then scope-checked. */
  async vehicle(scope: ResolvedScope, vehicleId: string, range: AnalyticsRange): Promise<Result<unknown>> {
    const exists = await this.client.query<{ id: string }>(
      `SELECT id FROM app.vehicles WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [vehicleId, scope.tenant_id],
    );
    if (exists.rows.length === 0) return err(new NotFound("Vehicle not found"));
    if (scope.vehicle_ids !== null && !scope.vehicle_ids.includes(vehicleId)) {
      return err(new Forbidden("That vehicle is outside your assigned scope"));
    }

    // Pin the scope to this one vehicle so the shared breakdown/KPI queries do the work.
    const pinned: ResolvedScope = { ...scope, vehicle_ids: [vehicleId], driver_ids: null };
    const [rows, kpis] = await Promise.all([
      this.vehicleBreakdown(pinned, range),
      this.kpisFor(pinned, range),
    ]);

    return ok({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      vehicle: rows[0] ?? {
        vehicle_id: vehicleId,
        plate: null,
        distanceKm: 0,
        fuelCost: 0,
        utilisationPct: 0,
        anomalies: 0,
      },
      kpis,
    });
  }

  /**
   * `GET /analytics/driver/{driverId}` and `GET /analytics/me`. A driver reaches their own row, a
   * manager the drivers they were assigned, an ADMIN anyone in the company.
   */
  async driver(scope: ResolvedScope, driverId: string, range: AnalyticsRange): Promise<Result<unknown>> {
    const exists = await this.client.query<{ id: string }>(
      `SELECT id FROM app.drivers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [driverId, scope.tenant_id],
    );
    if (exists.rows.length === 0) return err(new NotFound("Driver not found"));
    if (scope.driver_ids !== null && !scope.driver_ids.includes(driverId)) {
      return err(new Forbidden("That driver is outside your assigned scope"));
    }

    const pinned: ResolvedScope = { ...scope, vehicle_ids: null, driver_ids: [driverId] };
    const [rows, kpis] = await Promise.all([
      this.driverBreakdown(pinned, range),
      this.kpisFor(pinned, range),
    ]);

    return ok({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      driver: rows[0] ?? { driver_id: driverId, name: null, distanceKm: 0, shifts: 0, anomalies: 0 },
      kpis,
    });
  }

  /** Resolves the driver row backing `GET /analytics/me` for a signed-in driver. */
  async driverIdForUser(tenantId: string, userId: string): Promise<string | null> {
    const res = await this.client.query<{ id: string }>(
      `SELECT id FROM app.drivers
        WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [userId, tenantId],
    );
    return res.rows[0]?.id ?? null;
  }

  // ── Building blocks ────────────────────────────────────────────────────────────────────────

  /** Reads one manager's assignment rows and maps them through the shared scope rule. */
  private async scopeOfManager(tenantId: string, userId: string): Promise<ResolvedScope> {
    const res = await this.client.query<{ vehicle_id: string | null; driver_id: string | null }>(
      `SELECT vehicle_id, driver_id FROM app.manager_assignments
        WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    return scopeFromAssignmentRows(tenantId, res.rows);
  }

  /** Headline counters for a scope: fleet size, roster size, distance, fuel spend, open anomalies. */
  private async kpisFor(scope: ResolvedScope, range: AnalyticsRange): Promise<AnalyticsKpis> {
    const s = new ScopeSql(scope);
    const t = s.tenantParam;
    const vehicleScope = s.vehicle("v.id");
    const driverScope = s.driver("d.id");
    const shiftScope = s.either("sh.vehicle_id", "sh.driver_id");
    const from = s.add(range.from);
    const to = s.add(range.to);
    const fuelScope = s.either("fp.vehicle_id", "fp.driver_id");
    const anomalyScope = s.either("an.vehicle_id", "an.driver_id");

    const res = await this.client.query<Record<string, string | null>>(
      `SELECT
         (SELECT count(*) FROM app.vehicles v
           WHERE v.tenant_id = ${t} AND v.deleted_at IS NULL AND ${vehicleScope}) AS vehicles,
         (SELECT count(*) FROM app.drivers d
           WHERE d.tenant_id = ${t} AND d.deleted_at IS NULL AND ${driverScope}) AS drivers,
         (SELECT COALESCE(sum(GREATEST(sh.end_odometer_km - sh.start_odometer_km, 0)), 0)
            FROM app.shifts sh
           WHERE sh.tenant_id = ${t} AND sh.end_odometer_km IS NOT NULL
             AND sh.clock_in_at >= ${from} AND sh.clock_in_at <= ${to}
             AND ${shiftScope}) AS distance_km,
         (SELECT COALESCE(sum(fp.total_cost), 0) FROM app.fuel_purchases fp
           WHERE fp.tenant_id = ${t} AND fp.rejected_at IS NULL
             AND fp.purchased_at >= ${from} AND fp.purchased_at <= ${to}
             AND ${fuelScope}) AS fuel_cost,
         (SELECT count(*) FROM app.v_open_anomalies an
           WHERE an.detected_at >= ${from} AND an.detected_at <= ${to}
             AND ${anomalyScope}) AS anomalies`,
      s.params,
    );

    const row = res.rows[0] ?? {};
    return {
      vehicles: num(row.vehicles),
      drivers: num(row.drivers),
      distanceKm: num(row.distance_km),
      fuelCost: num(row.fuel_cost),
      anomalies: num(row.anomalies),
    };
  }

  /**
   * Flat counters mirroring the mobile `AnalyticsReportSchema`. They are scope-filtered like
   * everything else, so a manager's `/reports/analytics` shows their slice rather than the company.
   */
  private async legacyCounters(scope: ResolvedScope, range: AnalyticsRange) {
    const s = new ScopeSql(scope);
    const t = s.tenantParam;
    const vehicleScope = s.vehicle("v.id");
    const accidentScope = s.either("ar.vehicle_id", "ar.driver_id");
    const dvirScope = s.vehicle("i.vehicle_id");
    const docScope = s.vehicle("ad.vehicle_id");
    const from = s.add(range.from);
    const to = s.add(range.to);
    const fuelScope = s.either("fp.vehicle_id", "fp.driver_id");
    const anomalyScope = s.either("an.vehicle_id", "an.driver_id");

    const res = await this.client.query<Record<string, string | null>>(
      `SELECT
         (SELECT count(*) FROM app.vehicles v
           WHERE v.tenant_id = ${t} AND v.deleted_at IS NULL
             AND v.status <> 'RETIRED' AND ${vehicleScope}) AS active_fleet,
         (SELECT count(*) FROM app.accident_reports ar
           WHERE ar.tenant_id = ${t} AND ar.status IN ('PENDING', 'INVESTIGATING')
             AND ${accidentScope}) AS open_accidents,
         (SELECT count(*) FROM app.inspections i
           WHERE i.tenant_id = ${t} AND i.has_blocking_failure = true
             AND ${dvirScope}) AS pending_dvir,
         (SELECT count(*) FROM app.asset_documents ad
           WHERE ad.tenant_id = ${t} AND ad.deleted_at IS NULL
             AND ad.superseded_by_id IS NULL
             AND ad.expires_on IS NOT NULL
             AND ad.expires_on >= current_date
             AND ad.expires_on <= current_date + interval '30 days'
             AND ${docScope}) AS expiring_docs,
          (SELECT COALESCE(sum(fp.total_cost), 0) FROM app.fuel_purchases fp
            WHERE fp.tenant_id = ${t} AND fp.rejected_at IS NULL
              AND fp.purchased_at >= ${from} AND fp.purchased_at <= ${to}
              AND ${fuelScope}) AS fuel_spend_30d,
          (SELECT count(*) FROM app.v_open_anomalies an
            WHERE an.detected_at >= ${from} AND an.detected_at <= ${to}
              AND ${anomalyScope}) AS anomalies_open`,
      s.params,
    );

    const row = res.rows[0] ?? {};
    return {
      active_fleet: num(row.active_fleet),
      open_accidents: num(row.open_accidents),
      pending_dvir: num(row.pending_dvir),
      expiring_docs: num(row.expiring_docs),
      fuel_spend_30d: num(row.fuel_spend_30d),
      anomalies_open: num(row.anomalies_open),
    };
  }

  /**
   * One row per FLEET_MANAGER in the tenant, each scored against their OWN assignment scope. The raw
   * `app.manager_assignments` rows (including any null-subject row) are fed straight to the shared
   * `scopeFromAssignmentRows` helper, so this roll-up uses exactly the same "no rows ⇒ nothing" rule
   * as `resolveScope` and `scopeOfManager` — no third, diverging copy.
   */
  private async managerSummaries(
    scope: ResolvedScope,
    range: AnalyticsRange,
  ): Promise<ManagerAnalyticsSummary[]> {
    const res = await this.client.query<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      vehicle_id: string | null;
      driver_id: string | null;
    }>(
      `SELECT u.id AS user_id, u.email, u.full_name, ma.vehicle_id, ma.driver_id
          FROM app.users u
          JOIN app.user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = $1
          JOIN app.user_roles ur ON ur.user_id = u.id AND ur.role_code = 'FLEET_MANAGER'
          LEFT JOIN app.manager_assignments ma ON ma.user_id = u.id AND ma.tenant_id = $1
         WHERE u.deleted_at IS NULL
         ORDER BY u.email ASC`,
      [scope.tenant_id],
    );

    // Group the denormalised rows back into per-manager assignment lists.
    const byUser = new Map<
      string,
      { email: string | null; full_name: string | null; rows: { vehicle_id: string | null; driver_id: string | null }[] }
    >();
    for (const row of res.rows) {
      const entry =
        byUser.get(row.user_id) ??
        { email: row.email, full_name: row.full_name, rows: [] };
      // A manager with no assignments produces one row with both ids NULL from the LEFT JOIN.
      if (row.vehicle_id !== null || row.driver_id !== null) {
        entry.rows.push({ vehicle_id: row.vehicle_id, driver_id: row.driver_id });
      }
      byUser.set(row.user_id, entry);
    }

    const out: ManagerAnalyticsSummary[] = [];
    for (const [userId, entry] of byUser) {
      const managerScope = scopeFromAssignmentRows(scope.tenant_id, entry.rows);
      out.push({
        user_id: userId,
        full_name: entry.full_name,
        email: entry.email ?? "",
        assignedVehicleIds: managerScope.vehicle_ids,
        assignedDriverIds: managerScope.driver_ids,
        // Sequential rather than parallel: the read runs on ONE pooled client, and a pg client
        // cannot multiplex concurrent queries.
        kpis: await this.kpisFor(managerScope, range),
      });
    }
    return out;
  }

  /** Per-vehicle rows for a scope. `utilisationPct` = distinct shift days / days in the range. */
  private async vehicleBreakdown(scope: ResolvedScope, range: AnalyticsRange): Promise<VehicleAnalytics[]> {
    const s = new ScopeSql(scope);
    const t = s.tenantParam;
    const vehicleScope = s.vehicle("v.id");
    const from = s.add(range.from);
    const to = s.add(range.to);

    const res = await this.client.query<{
      vehicle_id: string;
      plate: string | null;
      distance_km: string | null;
      fuel_cost: string | null;
      active_days: string | null;
      anomalies: string | null;
    }>(
      `SELECT v.id AS vehicle_id,
              v.license_plate::text AS plate,
              COALESCE((SELECT sum(GREATEST(sh.end_odometer_km - sh.start_odometer_km, 0))
                          FROM app.shifts sh
                         WHERE sh.vehicle_id = v.id AND sh.tenant_id = ${t}
                           AND sh.end_odometer_km IS NOT NULL
                           AND sh.clock_in_at >= ${from} AND sh.clock_in_at <= ${to}), 0) AS distance_km,
              COALESCE((SELECT sum(fp.total_cost) FROM app.fuel_purchases fp
                         WHERE fp.vehicle_id = v.id AND fp.tenant_id = ${t}
                           AND fp.rejected_at IS NULL
                           AND fp.purchased_at >= ${from} AND fp.purchased_at <= ${to}), 0) AS fuel_cost,
              COALESCE((SELECT count(DISTINCT sh.operational_date) FROM app.shifts sh
                         WHERE sh.vehicle_id = v.id AND sh.tenant_id = ${t}
                           AND sh.clock_in_at >= ${from} AND sh.clock_in_at <= ${to}), 0) AS active_days,
              COALESCE((SELECT count(*) FROM app.v_open_anomalies an
                         WHERE an.vehicle_id = v.id
                           AND an.detected_at >= ${from} AND an.detected_at <= ${to}), 0) AS anomalies
         FROM app.vehicles v
        WHERE v.tenant_id = ${t} AND v.deleted_at IS NULL AND ${vehicleScope}
        ORDER BY v.license_plate ASC`,
      s.params,
    );

    const days = Math.max(
      1,
      Math.round((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    );
    return res.rows.map((r) => ({
      vehicle_id: r.vehicle_id,
      plate: r.plate,
      distanceKm: num(r.distance_km),
      fuelCost: num(r.fuel_cost),
      utilisationPct: Math.round(Math.min(100, (num(r.active_days) / days) * 100) * 10) / 10,
      anomalies: num(r.anomalies),
    }));
  }

  /** Per-driver rows for a scope. */
  private async driverBreakdown(scope: ResolvedScope, range: AnalyticsRange): Promise<DriverAnalytics[]> {
    const s = new ScopeSql(scope);
    const t = s.tenantParam;
    const driverScope = s.driver("d.id");
    const from = s.add(range.from);
    const to = s.add(range.to);

    const res = await this.client.query<{
      driver_id: string;
      name: string | null;
      distance_km: string | null;
      shifts: string | null;
      anomalies: string | null;
    }>(
      `SELECT d.id AS driver_id,
              u.full_name AS name,
              COALESCE((SELECT sum(GREATEST(sh.end_odometer_km - sh.start_odometer_km, 0))
                          FROM app.shifts sh
                         WHERE sh.driver_id = d.id AND sh.tenant_id = ${t}
                           AND sh.end_odometer_km IS NOT NULL
                           AND sh.clock_in_at >= ${from} AND sh.clock_in_at <= ${to}), 0) AS distance_km,
              COALESCE((SELECT count(*) FROM app.shifts sh
                         WHERE sh.driver_id = d.id AND sh.tenant_id = ${t}
                           AND sh.clock_in_at >= ${from} AND sh.clock_in_at <= ${to}), 0) AS shifts,
              COALESCE((SELECT count(*) FROM app.v_open_anomalies an
                         WHERE an.driver_id = d.id
                           AND an.detected_at >= ${from} AND an.detected_at <= ${to}), 0) AS anomalies
         FROM app.drivers d
         LEFT JOIN app.users u ON u.id = d.user_id
        WHERE d.tenant_id = ${t} AND d.deleted_at IS NULL AND ${driverScope}
        ORDER BY u.full_name ASC NULLS LAST`,
      s.params,
    );

    return res.rows.map((r) => ({
      driver_id: r.driver_id,
      name: r.name,
      distanceKm: num(r.distance_km),
      shifts: num(r.shifts),
      anomalies: num(r.anomalies),
    }));
  }
}
