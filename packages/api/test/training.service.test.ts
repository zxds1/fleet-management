// packages/api/test/training.service.test.ts
// Unit tests for TrainingService using hand-rolled fakes (no DB). Covers the completion path
// (unknown lesson → NOT_FOUND, happy path upserts + stages an outbox event, and the driver id is
// taken from the caller rather than the input), plus the lesson/roster cursor envelopes.

import { type DbClient, type Tx } from "@fleet/shared";
import type { TrainingEnrollmentRow } from "@fleet/shared";
import { TrainingService } from "../src/services/training";
import type { TrainingLessonListRow, TrainingRosterRow } from "../src/repositories/training";

const outbox: unknown[] = [];
const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: (e: unknown) => void outbox.push(e),
} as unknown as Tx;

const lesson: TrainingLessonListRow = {
  id: "les-1",
  course_id: "crs-1",
  course_code: "ONB",
  course_title: "Onboarding",
  is_mandatory: true,
  code: "L1",
  title: "Defensive driving",
  description: null,
  content_url: null,
  duration_minutes: 20,
  order_index: 1,
};

function makeService(
  overrides: {
    lesson?: TrainingLessonListRow | null;
    lessons?: TrainingLessonListRow[];
    roster?: TrainingRosterRow[];
  } = {},
) {
  const completions: unknown[] = [];

  const lessons = {
    findWithCourse: async () => (overrides.lesson !== undefined ? overrides.lesson : lesson),
    listWithCourse: async () => overrides.lessons ?? [lesson],
  } as unknown as import("../src/repositories/training").TrainingLessonRepository;

  const enrollments = {
    completeForDriver: async (input: unknown) => {
      completions.push(input);
      const typed = input as { driverId: string; lessonId: string; quizScore: number | null };
      return {
        id: "enr-1",
        driver_id: typed.driverId,
        lesson_id: typed.lessonId,
        status: "COMPLETED",
        completed_at: "2026-02-01T10:00:00.000Z",
        quiz_score: typed.quizScore,
      } as unknown as TrainingEnrollmentRow;
    },
    listRoster: async () => overrides.roster ?? [],
  } as unknown as import("../src/repositories/training").TrainingEnrollmentRepository;

  return { service: new TrainingService(lessons, enrollments), completions };
}

describe("TrainingService.completeLesson", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("maps an unknown lesson to NOT_FOUND", async () => {
    const { service } = makeService({ lesson: null });
    const result = await service.completeLesson(tx, "drv-1", "missing", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("completes for the calling driver and stages an outbox event", async () => {
    const { service, completions } = makeService();
    const result = await service.completeLesson(tx, "drv-1", "les-1", { quiz_score: 88 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("COMPLETED");
      expect(result.value.completed_at).toBe("2026-02-01T10:00:00.000Z");
    }
    // The driver id must come from the resolved principal, never the request body.
    expect(completions[0]).toMatchObject({ driverId: "drv-1", lessonId: "les-1", quizScore: 88 });
    expect(outbox[0]).toMatchObject({ event_type: "training.lesson.completed", aggregate_id: "enr-1" });
  });

  it("passes a null quiz score through when omitted", async () => {
    const { service, completions } = makeService();
    const result = await service.completeLesson(tx, "drv-1", "les-1", {});
    expect(result.ok).toBe(true);
    expect(completions[0]).toMatchObject({ quizScore: null });
  });
});

describe("TrainingService reads", () => {
  it("returns a lesson cursor page keyed on order_index", async () => {
    const { service } = makeService({ lessons: [lesson, { ...lesson, id: "les-2", order_index: 2 }] });
    const result = await service.listLessons({ limit: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(1);
      expect(result.value.has_more).toBe(true);
    }
  });

  it("maps an unknown lesson id to NOT_FOUND", async () => {
    const { service } = makeService({ lesson: null });
    const result = await service.getLesson("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("returns the roster page", async () => {
    const rosterRow: TrainingRosterRow = {
      id: "enr-1",
      driver_id: "drv-1",
      driver_name: "Asha N.",
      lesson_id: "les-1",
      lesson_title: "Defensive driving",
      course_title: "Onboarding",
      status: "COMPLETED",
      quiz_score: 88,
      completed_at: "2026-02-01T10:00:00.000Z",
      created_at: "2026-01-30T10:00:00.000Z",
    };
    const { service } = makeService({ roster: [rosterRow] });
    const result = await service.roster({ limit: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toHaveLength(1);
      expect(result.value.data[0]?.driver_name).toBe("Asha N.");
      expect(result.value.has_more).toBe(false);
    }
  });
});
