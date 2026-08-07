// packages/shared/src/schemas/fuel.ts
import { z } from "zod";

export const RefuelSchema = z.object({
  shift_id: z.string().uuid().nullable(),
  vehicle_id: z.string().uuid(),
  fuel_card_id: z.string().uuid().nullable().optional(),
  fuel_card_last_four: z.string().regex(/^\d{4}$/),
  litres: z.number().positive(),
  total_cost: z.object({ amount: z.string(), currency: z.string().length(3).default("KES") }),
  odometer_km: z.number().int().nonnegative(),
  purchased_at: z.string().datetime(),
  before_fuel_record_id: z.string().uuid(),
  after_fuel_record_id: z.string().uuid(),
  receipt_media_object_id: z.string().uuid(),
  supplier_name: z.string().max(120).optional(),
});
export type RefuelInput = z.infer<typeof RefuelSchema>;

export const VerifyPurchaseSchema = z.object({
  action: z.enum(["VERIFY", "REJECT", "CLEAR_PAYMENT"]),
  adjusted_litres: z.number().positive().optional(),
  rejection_reason: z.string().min(1).max(500).optional(),
});
export type VerifyPurchaseInput = z.infer<typeof VerifyPurchaseSchema>;
