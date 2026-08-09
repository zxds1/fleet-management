-- =============================================================================
-- Training / LMS  (Phase 3)
-- =============================================================================
-- Onboarding + compliance training courses and lessons, plus per-driver completion.
-- Referenced decisions: driver onboarding background checks + training hub spec.
-- Additive migration only (N10): new tables, no changes to existing ones.
-- -----------------------------------------------------------------------------

CREATE TABLE app.training_courses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL,
    title           text NOT NULL,
    description     text,
    is_mandatory    boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE UNIQUE INDEX training_courses_code_unique ON app.training_courses (code) WHERE deleted_at IS NULL;

CREATE TABLE app.training_lessons (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       uuid NOT NULL REFERENCES app.training_courses(id) ON DELETE CASCADE,
    code            text NOT NULL,
    title           text NOT NULL,
    description     text,
    content_url     text,
    duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    order_index     integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE UNIQUE INDEX training_lessons_course_code_unique
    ON app.training_lessons (course_id, code) WHERE deleted_at IS NULL;

-- Per-driver completion of a lesson (driver-side "complete"; manager-side "review").
CREATE TABLE app.training_enrollments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
    lesson_id       uuid NOT NULL REFERENCES app.training_lessons(id) ON DELETE CASCADE,
    status          app.training_status NOT NULL DEFAULT 'NOT_STARTED',
    completed_at    timestamptz,
    quiz_score      integer CHECK (quiz_score IS NULL OR (quiz_score >= 0 AND quiz_score <= 100)),
    reviewed_by     uuid REFERENCES app.users(id),
    reviewed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT training_enrollments_exactly_one_status
        CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE UNIQUE INDEX training_enrollments_driver_lesson_unique
    ON app.training_enrollments (driver_id, lesson_id) WHERE deleted_at IS NULL;
CREATE INDEX training_enrollments_driver_idx ON app.training_enrollments (driver_id, status);
