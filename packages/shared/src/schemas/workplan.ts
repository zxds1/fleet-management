// packages/shared/src/schemas/workplan.ts
import { z } from "zod";

/**
 * `GET /shifts/{shiftId}/work-plan` response — the clock-in work-plan capture. Tolerant: the exact
 * server shape is not part of the locked openapi contract yet, so unknown fields pass through.
 */
export const WorkPlanSchema = z
  .object({
    shift_id: z.string().uuid().optional(),
    planned_notes: z.string().max(2000).optional(),
    work_plan_media_object_ids: z.array(z.string()).optional(),
    items: z
      .array(
        z
          .object({ id: z.string().optional(), label: z.string().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type WorkPlan = z.infer<typeof WorkPlanSchema>;
