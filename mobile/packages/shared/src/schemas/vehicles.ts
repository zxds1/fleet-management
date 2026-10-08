import { z } from 'zod';

export const VehicleCreateSchema = z.object({
  license_plate: z.string().min(1).max(20),
  vehicle_class: z.string().max(40).optional(),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().min(1950).max(2100).optional(),
  ownership_type: z.string().max(40).optional(),
  fuel_tank_capacity_litres: z.coerce.number().positive().max(5000).optional(),
  notes: z.string().max(2000).optional(),
});
export type VehicleCreateInput = z.infer<typeof VehicleCreateSchema>;

export const VehicleUpdateSchema = z
  .object({
    status: z.string().max(40).optional(),
    is_operational: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
    non_operational_reason: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });
export type VehicleUpdateInput = z.infer<typeof VehicleUpdateSchema>;

export const AssignVehicleSchema = z.object({
  driver_ids: z.array(z.string().uuid()).max(500).default([]),
  vehicle_ids: z.array(z.string().uuid()).max(500).default([]),
});
export type AssignVehicleInput = z.infer<typeof AssignVehicleSchema>;
