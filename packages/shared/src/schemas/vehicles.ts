// packages/shared/src/schemas/vehicles.ts
// Vehicle master-data + assignment contract (`/vehicles`, `/admin/managers`). Mirrors
// api/openapi.yaml; the contract test fails the build if the two diverge.
//
// Note what is deliberately ABSENT from every request schema here: a tenant id. The tenant is
// always taken from the authenticated Principal (JWT `tid`), never from the request, so a caller
// cannot create a vehicle in — or assign across — another tenant by crafting a body.
//
// The response shapes mirror `VehicleRecordSchema` / `AdminSummarySchema` in
// packages/mobile/src/core/admin.ts: the mobile client parses tolerantly (all fields optional),
// so the server is free to return the superset of columns it already has.

import { z } from "zod";

/**
 * `POST /vehicles`. An ADMIN onboards a vehicle so there is something to assign to drivers and
 * managers. Only the fields the console collects are accepted; the server fills the rest
 * (`status` defaults to AVAILABLE, `is_operational` to true, `tracker_imei` stays NULL until the
 * A1.1 pairing flow runs, and `tenant_id` is bound to the caller).
 *
 * `license_plate` is unique per tenant (`vehicles_tenant_plate_unique`), which the route surfaces
 * as a 409 rather than letting the constraint violation escape as a 500.
 */
export const VehicleCreateSchema = z.object({
  license_plate: z.string().min(1).max(20),
  vehicle_class: z.string().max(40).optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  ownership_type: z.string().max(40).optional(),
  /**
   * `app.vehicles.fuel_tank_capacity_litres` is NOT NULL with a `> 0 AND <= 5000` CHECK because
   * the whole fuel-fraud calculation divides by it (A1.3/M1). The mobile create form leaves it
   * optional, so the route substitutes a documented placeholder the admin can correct later.
   */
  fuel_tank_capacity_litres: z.coerce.number().positive().max(5000).optional(),
  notes: z.string().max(2000).optional(),
});
export type VehicleCreateInput = z.infer<typeof VehicleCreateSchema>;

/** `PATCH /vehicles/{vehicleId}`. The narrow set of columns the console may edit in place. */
export const VehicleUpdateSchema = z
  .object({
    status: z.string().max(40).optional(),
    is_operational: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
    non_operational_reason: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type VehicleUpdateInput = z.infer<typeof VehicleUpdateSchema>;

/**
 * `GET /vehicles` row / `POST /vehicles` response (`app.vehicles`, Pillar 4). Numerics arrive from
 * PG as strings, so the money-like columns accept either and normalise to a number — the same
 * coercion the mobile `VehicleRecordSchema` performs.
 */
export const VehicleRecordSchema = z.object({
  id: z.string().uuid(),
  license_plate: z.string(),
  vehicle_class: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  is_operational: z.boolean().nullable().optional(),
  non_operational_reason: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  ownership_type: z.string().nullable().optional(),
  current_odometer_km: z.coerce.number().nullable().optional(),
  current_odometer_at: z.string().nullable().optional(),
  engine_hours: z.coerce.number().nullable().optional(),
  fuel_tank_capacity_litres: z.coerce.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type VehicleRecord = z.infer<typeof VehicleRecordSchema>;

/**
 * `POST /vehicles/{vehicleId}/assign`. Links drivers and other vehicles to one vehicle
 * ("an admin assigns cars and drivers to cars"). Both arrays carry REPLACE semantics: the client
 * sends the complete desired set and an empty array clears that dimension.
 *
 * `vehicle_ids` means *linked* vehicles (trailers, connected units), never a self-reference — the
 * route rejects the target vehicle appearing in its own list.
 */
export const AssignVehicleSchema = z.object({
  driver_ids: z.array(z.string().uuid()).max(500).default([]),
  vehicle_ids: z.array(z.string().uuid()).max(500).default([]),
});
export type AssignVehicleInput = z.infer<typeof AssignVehicleSchema>;

/**
 * `POST /admin/managers/{userId}/assign`. Replaces the vehicle + driver sets for one
 * admin/manager. Distinct from `AssignScopeSchema` (`/admin/users/{id}/assign`) only in that both
 * keys are required-with-default here, because the mobile client always sends the full set.
 */
export const AssignAdminsSchema = z.object({
  vehicle_ids: z.array(z.string().uuid()).max(500).default([]),
  driver_ids: z.array(z.string().uuid()).max(500).default([]),
});
export type AssignAdminsInput = z.infer<typeof AssignAdminsSchema>;

/**
 * One row of `GET /admin/managers`. A projection of `TenantUserSummary` under the field names the
 * mobile `AdminSummarySchema` reads. `assigned_vehicle_ids` / `assigned_driver_ids` are
 * authoritative: they are exactly what the matching POST replaces.
 */
export const AdminSummarySchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  roles: z.array(z.string()),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  assigned_vehicle_ids: z.array(z.string().uuid()),
  assigned_driver_ids: z.array(z.string().uuid()),
});
export type AdminSummary = z.infer<typeof AdminSummarySchema>;

/** `GET /admin/managers` response envelope. */
export const AdminRosterSchema = z.object({
  managers: z.array(AdminSummarySchema),
});
export type AdminRoster = z.infer<typeof AdminRosterSchema>;
