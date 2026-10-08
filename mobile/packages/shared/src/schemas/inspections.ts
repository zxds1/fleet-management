/**
 * DVIR wire shapes. Mirrors `fleet-management/packages/shared/src/schemas/inspections.ts` and the
 * `DvirSummaryRow` / `DvirDetailRow` / `DvirDetailItemRow` projections in
 * `packages/api/src/repositories/inspections.ts`.
 *
 * Real answer to "where does the checklist come from?": `GET /inspections/templates` returns
 * `{ templates: [{ template_id, name, label }] }` — it does NOT include the items, and there is no
 * other endpoint that does. The DVIR form therefore renders whatever items the server sends and
 * blocks submission when a template carries none, rather than inventing a checklist.
 */
import { z } from 'zod';
import { InspectionResult, InspectionSubject } from '../types';

export const InspectionItemSchema = z.object({
  template_item_id: z.string().uuid(),
  result: InspectionResult,
  /** Reefer temperature in Celsius (M6), when the template item asks for one. */
  numeric_value: z.number().optional(),
  notes: z.string().max(2000).optional(),
  photo_media_object_id: z.string().uuid().optional(),
});
export type InspectionItemInput = z.infer<typeof InspectionItemSchema>;

export const InspectionSubmitSchema = z.object({
  shift_id: z.string().uuid(),
  template_id: z.string().uuid(),
  subject: InspectionSubject,
  vehicle_id: z.string().uuid().nullable().optional(),
  trailer_id: z.string().uuid().nullable().optional(),
  previous_defects_reviewed: z.boolean(),
  signature_name: z.string().min(1).max(200),
  items: z.array(InspectionItemSchema).min(1),
});
export type InspectionSubmitInput = z.infer<typeof InspectionSubmitSchema>;

/**
 * The server-side rule the app mirrors so the driver finds out before submitting: a FAIL needs both
 * a note and a photo (`packages/api/src/services/inspections.ts`).
 */
export const InspectionSubmitStrictSchema = InspectionSubmitSchema.superRefine((v, ctx) => {
  v.items.forEach((item, i) => {
    // Only the FAIL rule is mirrored here, because that is the only one the submit body can express.
    // The NUMERIC range check needs the template's min/max, so the DVIR form applies it before it
    // builds the body (it has the template in hand).
    if (item.result !== 'FAIL') return;
    if (!item.notes || item.notes.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['items', i, 'notes'], message: 'A FAIL result must include a note.' });
    }
    if (!item.photo_media_object_id) {
      ctx.addIssue({ code: 'custom', path: ['items', i, 'photo_media_object_id'], message: 'DVIR_FAIL_NEEDS_PHOTO' });
    }
  });
});

export const InspectionSubmitResponseSchema = z.object({
  inspection_id: z.string().uuid(),
  block_shift: z.boolean(),
});

/**
 * One line of a checklist (`app.inspection_template_items`). The server sends BOTH languages so the
 * app never has to translate a driver-facing label, and `input_type` says how to ask:
 * `PASS_FAIL` needs a pass/fail/NA choice, `NUMERIC` needs a number (the reefer temperature, U-02).
 * `min_value` / `max_value` / `unit` are populated for NUMERIC and null for PASS_FAIL, which the
 * database enforces with a CHECK.
 */
export const InspectionTemplateItemOptionSchema = z.object({
  template_item_id: z.string().uuid(),
  /** Stable machine code (TIRES, REEFER_TEMP, ...). Used as the error key, never shown raw. */
  code: z.string(),
  label_en: z.string(),
  label_sw: z.string(),
  /** A BLOCKER FAIL grounds the asset; a WARNING is a recorded defect. */
  severity: z.enum(['BLOCKER', 'WARNING']),
  input_type: z.enum(['PASS_FAIL', 'NUMERIC']),
  unit: z.string().nullable(),
  min_value: z.number().nullable(),
  max_value: z.number().nullable(),
  is_required: z.boolean(),
  sequence: z.number().int(),
});
export type InspectionTemplateItemOption = z.infer<typeof InspectionTemplateItemOptionSchema>;

/** One checklist a driver may start (`InspectionTemplateOption`). */
export const InspectionTemplateOptionSchema = z
  .object({
    template_id: z.string().uuid(),
    name: z.string(),
    /** The server aliases `label` to `name`; both are sent. */
    label: z.string(),
    subject: z.string(),
    /** A published template always has items; an empty list means it was published empty. */
    items: z.array(InspectionTemplateItemOptionSchema).default([]),
  })
  .passthrough();

export const InspectionTemplatesResponseSchema = z.object({
  templates: z.array(InspectionTemplateOptionSchema),
});
export type InspectionTemplateOption = z.infer<typeof InspectionTemplateOptionSchema>;

/** One row of `GET /inspections` and `GET /inspections/me` (`DvirSummaryRow`). */
export const DvirSummaryRowSchema = z
  .object({
    inspection_id: z.string().uuid(),
    template_label: z.string().nullable(),
    vehicle_id: z.string().uuid().nullable(),
    vehicle_plate: z.string().nullable(),
    /** Derived: PASSED | DEFECTS | FAILED (the table has no status column). */
    status: z.string().nullable(),
    submitted_at: z.string().nullable(),
    defect_count: z.number().int().nonnegative().nullable(),
    quarantined: z.boolean().nullable(),
    block_shift: z.boolean().nullable(),
  })
  .passthrough();
export type DvirSummaryRow = z.infer<typeof DvirSummaryRowSchema>;

/** One checklist result on the detail screen (`DvirDetailItemRow`). */
export const DvirDetailItemSchema = z.object({
  template_item_id: z.string(),
  label: z.string(),
  result: z.string(),
  notes: z.string().nullable(),
  photo_count: z.number().int().nonnegative(),
  photo_media_object_id: z.string().nullable(),
  blocker: z.boolean(),
});
export type DvirDetailItem = z.infer<typeof DvirDetailItemSchema>;

/** `GET /inspections/{id}` (`DvirDetailView` = header row + items). */
export const DvirDetailSchema = DvirSummaryRowSchema.extend({
  vehicle_label: z.string().nullable().optional(),
  trailer_label: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  odometer_km: z.number().nullable().optional(),
  signature_name: z.string().optional(),
  items: z.array(DvirDetailItemSchema).default([]),
});
export type DvirDetail = z.infer<typeof DvirDetailSchema>;