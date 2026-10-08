import { z } from 'zod';

export const MaintenanceRecordSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid().nullable(),
  task_id: z.string(),
  vehicle_id: z.string().uuid().nullable(),
  trailer_id: z.string().uuid().nullable(),
  performed_at: z.string().datetime({ offset: true }),
  odometer_km: z.number().int().min(0).nullable(),
  engine_hours: z.string().nullable(),
  vendor: z.string().nullable(),
  cost: z.number().min(0).nullable(),
  currency: z.string().length(3),
  parts_used: z.string().nullable(),
  downtime_days: z.string().nullable(),
  invoice_media_object_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
});
export type MaintenanceRecord = z.infer<typeof MaintenanceRecordSchema>;

export const WorkOrderCreateSchema = z
  .object({
    vehicle_id: z.string().uuid().optional(),
    trailer_id: z.string().uuid().optional(),
    task_code: z.string().min(1).max(80),
    performed_at: z.string().datetime({ offset: true }),
    odometer_km: z.number().int().min(0).max(9_999_999).optional(),
    vendor: z.string().max(200).optional(),
    cost: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Boolean(v.vehicle_id) !== Boolean(v.trailer_id), {
    message: 'Provide exactly one of vehicle_id or trailer_id',
    path: ['vehicle_id'],
  });
export type WorkOrderCreateInput = z.infer<typeof WorkOrderCreateSchema>;
