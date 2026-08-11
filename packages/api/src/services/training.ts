// packages/api/src/services/training.ts
// Training / LMS service (Phase 3, 12_training.sql). Returns Result<T> and never throws for a
// domain rule (08 §1). Lesson reads are keyset paginated (D7) and run on a pooled client; the
// completion write runs inside the request transaction and stages an outbox event so the worker can
// notify the reviewing manager (D8). Completion is always scoped to the calling driver — the driver
// id comes from the resolved principal, never from the request body.

import { type Result, type Tx, ok, err, NotFound } from "@fleet/shared";
import type { TrainingEnrollmentRow } from "@fleet/shared";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage, type CursorPage } from "../http/pagination";
import type {
  TrainingEnrollmentRepository,
  TrainingLessonListRow,
  TrainingLessonRepository,
  TrainingRosterRow,
} from "../repositories/training";

export class TrainingService {
  constructor(
    private readonly lessons: TrainingLessonRepository,
    private readonly enrollments: TrainingEnrollmentRepository,
  ) {}

  /** Cursor page of lessons joined to their course, ordered by the curriculum sequence. */
  async listLessons(opts: { limit: number; cursor?: string | null }): Promise<Result<CursorPage<TrainingLessonListRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.lessons.listWithCourse({
      limit: limit + 1,
      ...(cursor ? { cursorSort: cursor.sort, cursorId: cursor.id } : {}),
    });
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.order_index ?? 0), id: row.id })));
  }

  /** Single lesson. Unknown or soft-deleted id → NotFound (404). */
  async getLesson(id: string): Promise<Result<TrainingLessonListRow>> {
    const row = await this.lessons.findWithCourse(id);
    if (!row) return err(new NotFound("Training lesson not found"));
    return ok(row);
  }

  /**
   * Marks a lesson complete for the calling driver. Upserts the enrolment so a repeated completion
   * (an offline retry, or a driver re-taking the quiz) is idempotent at the data level: the first
   * completed_at is preserved and only a non-null quiz score overwrites the stored one.
   */
  async completeLesson(
    tx: Tx,
    driverId: string,
    lessonId: string,
    input: { quiz_score?: number },
  ): Promise<Result<{ id: string; lesson_id: string; status: TrainingEnrollmentRow["status"]; completed_at: string | null }>> {
    const lesson = await this.lessons.findWithCourse(lessonId);
    if (!lesson) return err(new NotFound("Training lesson not found"));

    const row = await this.enrollments.completeForDriver({
      driverId,
      lessonId,
      quizScore: input.quiz_score ?? null,
    });

    tx.registerOutbox({
      event_type: "training.lesson.completed",
      aggregate_type: "training_enrollment",
      aggregate_id: row.id,
      payload: {
        id: row.id,
        driver_id: driverId,
        lesson_id: lessonId,
        lesson_title: lesson.title,
        quiz_score: row.quiz_score,
      },
    });

    return ok({
      id: row.id,
      lesson_id: row.lesson_id,
      status: row.status,
      completed_at: row.completed_at,
    });
  }

  /** Manager roster of every enrolment (training:review). Keyset on (created_at, id) DESC. */
  async roster(opts: { limit: number; cursor?: string | null }): Promise<Result<CursorPage<TrainingRosterRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.enrollments.listRoster({
      limit: limit + 1,
      ...(cursor ? { cursorSort: cursor.sort, cursorId: cursor.id } : {}),
    });
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.created_at ?? ""), id: row.id })));
  }

  /**
   * Driver training status for `GET /drivers/me/training-status` (contract status endpoint).
   * `completed_lessons` are the lesson ids the driver has completed; `total_lessons` is the count of
   * (non-deleted) lessons; `all_complete` follows the contract exactly: completed >= total.
   */
  async trainingStatus(driverId: string): Promise<{
    completed_lessons: string[];
    total_lessons: number;
    all_complete: boolean;
  }> {
    const { completedLessonIds, totalLessons } = await this.enrollments.getStatus(driverId);
    return {
      completed_lessons: completedLessonIds,
      total_lessons: totalLessons,
      all_complete: completedLessonIds.length >= totalLessons,
    };
  }
}
