// packages/shared/src/schemas/media.ts
import { z } from "zod";

/**
 * The media owner kinds, mirroring the `app.media_owner_kind` enum in db/schema/01_enums.sql.
 *
 * The two lists MUST stay identical: a value accepted here but missing from the database enum
 * would pass validation and then fail the INSERT with a raw 500. The vehicle-issue capture path
 * uploads under `MAINTENANCE_RECORD` (the issue photo is a maintenance artefact), so that is the
 * kind the client sends for it — there is no `VEHICLE_ISSUE` owner kind in the database.
 */
export const MEDIA_OWNER_KINDS = [
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
] as const;

/** The media retention classes, mirroring `app.media_retention_class` (db/schema/01_enums.sql). */
export const MEDIA_RETENTION_CLASSES = [
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
] as const;

export const MediaUploadSchema = z
  .object({
    owner_kind: z.enum(MEDIA_OWNER_KINDS),
    retention_class: z.enum(MEDIA_RETENTION_CLASSES),
    content_type: z.string().min(1).max(200),
    width_px: z.number().int().positive().optional(),
    height_px: z.number().int().positive().optional(),
    client_captured_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type MediaUploadInput = z.infer<typeof MediaUploadSchema>;
