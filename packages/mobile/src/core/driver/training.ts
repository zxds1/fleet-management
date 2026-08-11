// packages/mobile/src/core/driver/training.ts
//
// Driver training / LMS journey (training hub → lesson detail → resource library). Pure over an
// injected `ApiClient`, mirroring `OnboardingService`: there is no evidence upload and no offline
// outbox. A completion is a server-authoritative fact about the *calling* driver's enrolment, so a
// transport failure must surface to the screen rather than be replayed later against a lesson the
// catalogue may have retired.
//
// Endpoints (already implemented server-side, packages/api/src/http/routes/training.ts):
//   • GET  /training/lessons              → cursor page of lessons joined to their course
//   • GET  /training/lessons/{id}         → one lesson joined to its course
//   • POST /training/lessons/{id}/complete → completes the CURRENT driver's enrolment
//
// `Idempotency-Key` is attached by `ApiClient.request` for every non-GET/DELETE call (C5.1), so the
// POST below simply uses `api.send` without threading a key by hand.
//
// The schemas are *view* schemas local to the mobile client: deliberately tolerant (nullable /
// optional on everything a screen can render as "—") so one sparse row never blanks the catalogue.

import { z } from "zod"
import type { ApiClient } from "../apiClient"

/** Enrolment lifecycle as stored in `app.training_enrollments.status`. */
export const TrainingStatusSchema = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "EXPIRED"])
export type TrainingStatus = z.infer<typeof TrainingStatusSchema>

/**
 * `GET /training/lessons` row — a lesson joined to its parent course
 * (`TrainingLessonListRow` in packages/api/src/repositories/training.ts).
 */
export const TrainingLessonSchema = z.object({
  id: z.string(),
  course_id: z.string(),
  course_code: z.string().nullable().optional(),
  course_title: z.string().nullable().optional(),
  is_mandatory: z.boolean().nullable().optional(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  content_url: z.string().nullable().optional(),
  duration_minutes: z.number().int().nullable().optional(),
  order_index: z.number().int().nullable().optional().transform((v) => v ?? 0),
})
export type TrainingLesson = z.infer<typeof TrainingLessonSchema>

/**
 * `POST /training/lessons/{id}/complete` response — the upserted enrolment row. Tolerant on the
 * timestamps because only `status` and `quiz_score` drive the screen.
 */
export const TrainingEnrollmentSchema = z.object({
  id: z.string(),
  driver_id: z.string().nullable().optional(),
  lesson_id: z.string().nullable().optional(),
  status: z
    .string()
    .nullable()
    .optional()
    .transform((v): TrainingStatus => {
      const parsed = TrainingStatusSchema.safeParse(v)
      return parsed.success ? parsed.data : "COMPLETED"
    }),
  quiz_score: z.number().int().nullable().optional(),
  completed_at: z.string().nullable().optional(),
})
export type TrainingEnrollment = z.infer<typeof TrainingEnrollmentSchema>

/** Cursor envelope (D7) as returned by the gateway list endpoints. */
const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().nullable().optional(),
    has_more: z.boolean().nullable().optional(),
  })

/**
 * One downloadable / viewable resource in the driver resource library. There is no dedicated
 * backend resource endpoint yet, so the library is derived from the lesson catalogue: every lesson
 * that carries a `content_url` is a resource, grouped by its course.
 */
export interface TrainingResource {
  /** The originating lesson id (stable, unique). */
  id: string
  title: string
  description: string | null
  /** Course title the resource belongs to, used as the library section heading. */
  category: string | null
  /** Absolute or relative URL of the lesson content; `null` when the lesson has none. */
  url: string | null
  /** Coarse resource kind derived from the URL extension (drives the icon + action label). */
  kind: TrainingResourceKind
}

export type TrainingResourceKind = "document" | "video" | "link"

/** Classify a content URL so the library can pick an icon and the right action verb. */
export function resourceKindFor(url: string | null | undefined): TrainingResourceKind {
  if (!url) return "link"
  const path = url.split(/[?#]/)[0] ?? ""
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(path)) return "document"
  if (/\.(mp4|mov|m4v|webm|avi)$/i.test(path)) return "video"
  if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return "video"
  return "link"
}

/** Project a lesson onto the resource-library read model. */
export function lessonToResource(lesson: TrainingLesson): TrainingResource {
  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description ?? null,
    category: lesson.course_title ?? lesson.course_code ?? null,
    url: lesson.content_url ?? null,
    kind: resourceKindFor(lesson.content_url),
  }
}

export class TrainingService {
  constructor(private readonly api: ApiClient) {}

  /**
   * The published lesson catalogue (`training:read`). The gateway paginates on
   * `(order_index, id) ASC`; the driver hub shows the whole catalogue, so a generous single page is
   * requested rather than looping — the catalogue is small and bounded by the course set.
   */
  async listLessons(limit = 100): Promise<TrainingLesson[]> {
    const raw = await this.api.request<unknown>(`/training/lessons?limit=${limit}`, { method: "GET" })
    const page = PageSchema(TrainingLessonSchema).safeParse(raw)
    if (page.success) return page.data.data
    // Tolerate a bare array should the envelope ever be flattened.
    const bare = z.array(TrainingLessonSchema).safeParse(raw)
    return bare.success ? bare.data : []
  }

  /** One lesson (`training:read`). Returns `null` when the lesson is missing or unreadable. */
  async getLesson(id: string): Promise<TrainingLesson | null> {
    const raw = await this.api.request<unknown>(`/training/lessons/${encodeURIComponent(id)}`, { method: "GET" })
    const parsed = TrainingLessonSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  /**
   * Marks the lesson complete for the signed-in driver (`training:complete`). The server resolves
   * the driver from the principal — never from a body field — so there is nothing to pass but the
   * optional quiz score.
   */
  async completeLesson(id: string, quizScore?: number): Promise<TrainingEnrollment> {
    const res = await this.api.send<unknown>(
      "POST",
      `/training/lessons/${encodeURIComponent(id)}/complete`,
      quizScore != null ? { quiz_score: quizScore } : {},
    )
    const parsed = TrainingEnrollmentSchema.safeParse(res)
    // The write succeeded even if the echo is unrecognised; synthesise the completed view.
    return parsed.success
      ? parsed.data
      : { id, driver_id: null, lesson_id: id, status: "COMPLETED", quiz_score: quizScore ?? null, completed_at: null }
  }

  /** The resource library: every lesson in the catalogue projected onto the resource read model. */
  async listResources(limit = 100): Promise<TrainingResource[]> {
    const lessons = await this.listLessons(limit)
    return lessons.map(lessonToResource)
  }
}
