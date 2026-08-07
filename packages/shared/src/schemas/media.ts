// packages/shared/src/schemas/media.ts
import { z } from "zod";

export const MediaUploadSchema = z.object({
  owner_kind: z.enum([
    "WORK_LOG",
    "INSPECTION_ITEM",
    "FUEL_RECORD",
    "FUEL_PURCHASE",
    "EXPENSE",
    "ACCIDENT_REPORT",
    "ASSET_DOCUMENT",
    "TRAILER_ASSIGNMENT",
    "MAINTENANCE_RECORD",
    "QUARANTINE_EVENT",
    "STATEMENT_IMPORT",
  ]),
  retention_class: z.enum([
    "WORK_PLAN",
    "INSPECTION",
    "FUEL_RECEIPT",
    "FUEL_DASHBOARD",
    "EXPENSE_RECEIPT",
    "ACCIDENT",
    "ASSET_DOCUMENT",
    "MAINTENANCE",
    "STATEMENT_IMPORT",
    "TRAILER_SWAP",
  ]),
  content_type: z.string().min(1).max(200),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
  client_captured_at: z.string().datetime({ offset: true }).optional(),
});
export type MediaUploadInput = z.infer<typeof MediaUploadSchema>;
