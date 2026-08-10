// packages/api/src/services/vehicles.ts
// Vehicle master data + assignment (Pillar 4, `/vehicles`). Business rules live here; the
// repositories stay parameterised-SQL only (06 §2).
//
// The invariant every method upholds is the same one the tenancy service enforces: the tenant comes
// from the CALLER's Principal, never from the request. A vehicle is created inside the caller's
// tenant, is only ever read back through a tenant-filtered query, and an assignment can only name
// ids that already belong to that tenant.

import {
  ConflictError,
  NotFound,
  ValidationError,
  err,
  ok,
  type Result,
  type VehicleRecord,
  type VehicleRow,
} from "@fleet/shared";
import type { AssignmentRepository, VehicleRepository } from "../repositories/shifts";
import type { DriverRepository } from "../repositories/identity";
import type { ManagerAssignmentRepository } from "../repositories/tenancy";

/**
 * `app.vehicles.fuel_tank_capacity_litres` is NOT NULL with a `> 0` CHECK (A1.3/M1) because the
 * fuel-fraud calculation divides by it, but the mobile create form does not collect it. A vehicle
 * that cannot be created at all is worse than one carrying an obvious placeholder, so creation
 * falls back to this value and the admin corrects it during onboarding.
 */
export const DEFAULT_FUEL_TANK_CAPACITY_LITRES = 1;

/** PG unique-violation. Raised by `vehicles_tenant_plate_unique` on a duplicate plate. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/**
 * Maps `app.vehicles` onto the wire shape the mobile `VehicleRecordSchema` reads. Numeric columns
 * come back from PG as strings, so they are normalised to numbers here rather than in the screen.
 */
export function toVehicleRecord(row: VehicleRow): VehicleRecord {
  const num = (v: string | number | null): number | null =>
    v === null || v === "" ? null : Number(v);
  return {
    id: row.id,
    license_plate: row.license_plate,
    vehicle_class: row.vehicle_class ?? null,
    status: row.status ?? null,
    is_operational: row.is_operational ?? null,
    non_operational_reason: row.non_operational_reason ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    ownership_type: row.ownership_type ?? null,
    current_odometer_km: num(row.current_odometer_km ?? null),
    current_odometer_at: row.current_odometer_at ?? null,
    engine_hours: num(row.engine_hours),
    fuel_tank_capacity_litres: num(row.fuel_tank_capacity_litres),
    notes: row.notes ?? null,
  };
}

export interface VehicleListInput {
  tenantId: string;
  limit: number;
  cursor?: { sort: string; id: string } | null;
}

export class VehicleService {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly drivers: DriverRepository,
    private readonly assignments: AssignmentRepository,
    private readonly managerAssignments: ManagerAssignmentRepository,
  ) {}

  /** `GET /vehicles`. Fetches `limit + 1` rows so the caller can build the cursor envelope (D7). */
  async list(input: VehicleListInput): Promise<Result<VehicleRow[]>> {
    const rows = await this.vehicles.listByTenant({
      tenantId: input.tenantId,
      limit: input.limit + 1,
      cursor: input.cursor ?? null,
    });
    return ok(rows);
  }

  /** `GET /vehicles/{vehicleId}`. A vehicle in another tenant is a 404, never a 403. */
  async get(tenantId: string, vehicleId: string): Promise<Result<VehicleRecord>> {
    const row = await this.vehicles.findByIdForTenant(tenantId, vehicleId);
    if (!row) return err(new NotFound("Vehicle not found"));
    return ok(toVehicleRecord(row));
  }

  /**
   * `POST /vehicles`. The plate is unique per tenant, so a duplicate is a 409 rather than an
   * unhandled constraint violation. The check is made explicitly AND the constraint error is
   * caught: the pre-check gives a clean message, the catch closes the race between two concurrent
   * creates of the same plate.
   */
  async create(input: {
    tenantId: string;
    licensePlate: string;
    vehicleClass?: string | undefined;
    make?: string | undefined;
    model?: string | undefined;
    year?: number | undefined;
    ownershipType?: string | undefined;
    fuelTankCapacityLitres?: number | undefined;
    notes?: string | undefined;
  }): Promise<Result<VehicleRecord>> {
    const licensePlate = input.licensePlate.trim().toUpperCase();
    if (licensePlate.length === 0) {
      return err(new ValidationError("license_plate must not be blank"));
    }

    const existing = await this.vehicles.findByPlateForTenant(input.tenantId, licensePlate);
    if (existing) {
      return err(
        new ConflictError(
          "VEHICLE_PLATE_EXISTS",
          "Vehicle already exists",
          `A vehicle with plate ${licensePlate} already exists in this company`,
        ),
      );
    }

    try {
      const row = await this.vehicles.createForTenant({
        tenantId: input.tenantId,
        licensePlate,
        vehicleClass: input.vehicleClass,
        make: input.make,
        model: input.model,
        year: input.year,
        ownershipType: input.ownershipType,
        fuelTankCapacityLitres:
          input.fuelTankCapacityLitres ?? DEFAULT_FUEL_TANK_CAPACITY_LITRES,
        notes: input.notes,
      });
      return ok(toVehicleRecord(row));
    } catch (e) {
      if (isUniqueViolation(e)) {
        return err(
          new ConflictError(
            "VEHICLE_PLATE_EXISTS",
            "Vehicle already exists",
            `A vehicle with plate ${licensePlate} already exists in this company`,
          ),
        );
      }
      throw e;
    }
  }

  /** `PATCH /vehicles/{vehicleId}`. Tenant-scoped; a miss is a 404. */
  async update(input: {
    tenantId: string;
    vehicleId: string;
    status?: string | undefined;
    isOperational?: boolean | undefined;
    notes?: string | null | undefined;
    nonOperationalReason?: string | null | undefined;
  }): Promise<Result<VehicleRecord>> {
    const row = await this.vehicles.updateForTenant(input);
    if (!row) return err(new NotFound("Vehicle not found"));
    return ok(toVehicleRecord(row));
  }

  /**
   * `POST /vehicles/{vehicleId}/assign`. Links drivers and other vehicles to one vehicle, with
   * REPLACE semantics (the client sends the complete desired set on both dimensions).
   *
   * How the linkage is stored, and why:
   *   * driver → vehicle is `app.assignments`, the real dispatch table. It already models exactly
   *     this edge (`driver_id` + `vehicle_id`) and is what clock-in checks (C1.8), so a driver
   *     assigned here can actually start a shift on the car. The rows are keyed to the current
   *     operational date and superseded on the next call rather than duplicated.
   *   * vehicle → vehicle is recorded through `app.manager_assignments` for the OPERATORS of the
   *     target vehicle, i.e. every manager already scoped to it also gains the linked units. That
   *     keeps the trailer visible to whoever owns the tractor without inventing a table.
   *
   * Every referenced id is resolved through a tenant-scoped lookup first, so an id from another
   * tenant is rejected outright rather than silently written — this is the IDOR surface.
   */
  async assign(input: {
    tenantId: string;
    vehicleId: string;
    driverIds: string[];
    vehicleIds: string[];
    actorUserId: string;
  }): Promise<Result<{ driver_ids: string[]; vehicle_ids: string[] }>> {
    const target = await this.vehicles.findByIdForTenant(input.tenantId, input.vehicleId);
    if (!target) return err(new NotFound("Vehicle not found"));

    // `vehicle_ids` are LINKED vehicles (trailers, connected units), so the target naming itself
    // is meaningless and is rejected rather than stored as a self-edge.
    if (input.vehicleIds.includes(input.vehicleId)) {
      return err(
        new ValidationError("A vehicle cannot be linked to itself", [
          { field: "vehicle_ids", code: "SELF_LINK", message: "Remove the target vehicle id" },
        ]),
      );
    }

    // Cross-tenant ids never reach the write: they are resolved by a tenant-scoped lookup and any
    // shortfall is reported as a conflict instead of being dropped.
    const resolvedVehicles = await this.vehicles.filterIdsInTenant(input.tenantId, input.vehicleIds);
    if (resolvedVehicles.length !== new Set(input.vehicleIds).size) {
      return err(
        new ConflictError(
          "VEHICLE_NOT_IN_TENANT",
          "Unknown vehicle",
          "One or more vehicle_ids do not belong to this company",
        ),
      );
    }

    const resolvedDrivers = await this.drivers.resolveIdsInTenant(input.tenantId, input.driverIds);
    if (resolvedDrivers.length !== new Set(input.driverIds).size) {
      return err(
        new ConflictError(
          "DRIVER_NOT_IN_TENANT",
          "Unknown driver",
          "One or more driver_ids do not belong to this company",
        ),
      );
    }

    await this.assignments.replaceDriversForVehicle({
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      driverIds: resolvedDrivers,
      createdBy: input.actorUserId,
    });

    // Widen every manager already scoped to the target so the linked units travel with it. This is
    // deliberately additive: it must never rewrite the acting admin's own manager scope.
    await this.managerAssignments.linkVehiclesToVehicleOperators({
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      linkedVehicleIds: resolvedVehicles,
      assignedBy: input.actorUserId,
    });

    return ok({ driver_ids: resolvedDrivers, vehicle_ids: resolvedVehicles });
  }
}
