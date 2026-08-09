// packages/api/src/repositories/training.ts
// Training / LMS repositories (12_training.sql). Parameterised SQL only; no business rules (06 §2).
// All three tables are soft-deletable (deleted_at), so BaseRepository's default applies. Read models
// are declared here and their SQL aliases match the DTO field names exactly, so there is no JS-side
// mapping step (06 §3.1.6).

import { BaseRepository } from "@fleet/db";
import type {
  DbClient,
  TrainingCourseRow,
  TrainingEnrollmentRow,
  TrainingLessonRow,
  TrainingStatus,
} from "@fleet/shared";

/** Lesson joined to its parent course, for `GET /training/lessons` and `/training/lessons/{id}`. */
export interface TrainingLessonListRow {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  is_mandatory: boolean;
  code: string;
  title: string;
  description: string | null;
  content_url: string | null;
  duration_minutes: number | null;
  order_index: number;
}

/** Manager roster row for `GET /training/roster` (training:review). */
export interface TrainingRosterRow {
  id: string;
  driver_id: string;
  driver_name: string | null;
  lesson_id: string;
  lesson_title: string;
  course_title: string;
  status: TrainingStatus;
  quiz_score: number | null;
  completed_at: string | null;
  /** Keyset sort column for the roster page (enrolment creation, not completion). */
  created_at: string;
}

export class TrainingCourseRepository extends BaseRepository<TrainingCourseRow> {
  constructor(client: DbClient) {
    super(client, "app.training_courses");
  }
}

export class TrainingLessonRepository extends BaseRepository<TrainingLessonRow> {
  constructor(client: DbClient) {
    super(client, "app.training_lessons");
  }

  /**
   * Lessons joined to their course, keyset paginated on (order_index, id) ASC. Soft-deleted
   * lessons and courses are invisible. Fetches limit + 1 for `has_more`.
   */
  async listWithCourse(opts: {
    limit: number;
    cursorSort?: string;
    cursorId?: string;
  }): Promise<TrainingLessonListRow[]> {
    const params: unknown[] = [];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (l.order_index, l.id) > ($${params.length - 1}::int, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<TrainingLessonListRow>(
      `SELECT l.id               AS id,
              l.course_id        AS course_id,
              c.code             AS course_code,
              c.title            AS course_title,
              c.is_mandatory     AS is_mandatory,
              l.code             AS code,
              l.title            AS title,
              l.description      AS description,
              l.content_url      AS content_url,
              l.duration_minutes AS duration_minutes,
              l.order_index      AS order_index
         FROM app.training_lessons l
         JOIN app.training_courses c ON c.id = l.course_id AND c.deleted_at IS NULL
        WHERE l.deleted_at IS NULL ${keyset}
        ORDER BY l.order_index ASC, l.id ASC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Single lesson joined to its course. Soft-deleted rows read as null. */
  async findWithCourse(id: string): Promise<TrainingLessonListRow | null> {
    const res = await this.client.query<TrainingLessonListRow>(
      `SELECT l.id               AS id,
              l.course_id        AS course_id,
              c.code             AS course_code,
              c.title            AS course_title,
              c.is_mandatory     AS is_mandatory,
              l.code             AS code,
              l.title            AS title,
              l.description      AS description,
              l.content_url      AS content_url,
              l.duration_minutes AS duration_minutes,
              l.order_index      AS order_index
         FROM app.training_lessons l
         JOIN app.training_courses c ON c.id = l.course_id AND c.deleted_at IS NULL
        WHERE l.id = $1::uuid AND l.deleted_at IS NULL
        LIMIT 1`,
      [id],
    );
    return res.rows[0] ?? null;
  }
}

export class TrainingEnrollmentRepository extends BaseRepository<TrainingEnrollmentRow> {
  constructor(client: DbClient) {
    super(client, "app.training_enrollments");
  }

  /**
   * Marks a lesson complete for one driver. `training_enrollments_driver_lesson_unique` is a
   * partial unique index (WHERE deleted_at IS NULL), so the conflict target must repeat that
   * predicate for ON CONFLICT to match it.
   */
  async completeForDriver(input: {
    driverId: string;
    lessonId: string;
    quizScore: number | null;
  }): Promise<TrainingEnrollmentRow> {
    const res = await this.client.query<TrainingEnrollmentRow>(
      `INSERT INTO app.training_enrollments (driver_id, lesson_id, status, completed_at, quiz_score)
       VALUES ($1::uuid, $2::uuid, 'COMPLETED', now(), $3::int)
       ON CONFLICT (driver_id, lesson_id) WHERE deleted_at IS NULL
       DO UPDATE SET status       = 'COMPLETED',
                     completed_at = COALESCE(app.training_enrollments.completed_at, now()),
                     quiz_score   = COALESCE(EXCLUDED.quiz_score, app.training_enrollments.quiz_score),
                     updated_at   = now()
       RETURNING *`,
      [input.driverId, input.lessonId, input.quizScore],
    );
    return res.rows[0] as TrainingEnrollmentRow;
  }

  /**
   * Manager roster: every enrolment with the driver's name and the lesson/course titles. Keyset
   * paginated on (created_at, id) DESC. Fetches limit + 1 for `has_more`.
   */
  async listRoster(opts: {
    limit: number;
    cursorSort?: string;
    cursorId?: string;
  }): Promise<TrainingRosterRow[]> {
    const params: unknown[] = [];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (e.created_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<TrainingRosterRow>(
      `SELECT e.id           AS id,
              e.driver_id    AS driver_id,
              u.full_name    AS driver_name,
              e.lesson_id    AS lesson_id,
              l.title        AS lesson_title,
              c.title        AS course_title,
              e.status       AS status,
              e.quiz_score   AS quiz_score,
              e.completed_at AS completed_at,
              e.created_at   AS created_at
         FROM app.training_enrollments e
         JOIN app.training_lessons l ON l.id = e.lesson_id
         JOIN app.training_courses c ON c.id = l.course_id
         LEFT JOIN app.drivers d ON d.id = e.driver_id
         LEFT JOIN app.users   u ON u.id = d.user_id
        WHERE e.deleted_at IS NULL ${keyset}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }
}
