// packages/mobile/src/core/__tests__/training.test.ts
//
// Driver training service (core/driver/training.ts) over a fake fetch: catalogue parsing, the
// self-completion POST (driver resolved server-side from the principal, never from the body), and
// the resource-library projection derived from `content_url`.

import { ApiClient } from "../apiClient";
import { TrainingService, resourceKindFor, lessonToResource } from "../driver/training";

function lesson(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    course_id: "22222222-2222-4222-8222-222222222222",
    course_code: "SAFETY",
    course_title: "Safety First",
    is_mandatory: true,
    code: "L1",
    title: "Understanding stopping distances",
    description: "Physics of momentum.",
    content_url: "https://cdn.example.com/lessons/l1.pdf",
    duration_minutes: 45,
    order_index: 0,
    ...over,
  };
}

function clientWith(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const next = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers as Record<string, string>,
    });
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      statusText: "",
      text: async () => JSON.stringify(next.body),
    };
  }) as unknown as typeof fetch;
  const api = new ApiClient({
    baseUrl: "https://api.test",
    fetchImpl,
    getToken: () => "tok",
    makeIdempotencyKey: () => "idem-1",
  });
  return { api, calls };
}

describe("TrainingService", () => {
  it("parses the cursor page returned by GET /training/lessons", async () => {
    const { api, calls } = clientWith([{ body: { data: [lesson()], next_cursor: null, has_more: false } }]);
    const lessons = await new TrainingService(api).listLessons();
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.title).toBe("Understanding stopping distances");
    expect(calls[0]!.url).toContain("/training/lessons?limit=100");
    expect(calls[0]!.method).toBe("GET");
  });

  it("tolerates a sparse row (nulls on every optional field)", async () => {
    const sparse = {
      id: "a",
      course_id: "b",
      code: "L9",
      title: "Bare lesson",
      description: null,
      content_url: null,
      duration_minutes: null,
      order_index: null,
    };
    const { api } = clientWith([{ body: { data: [sparse], next_cursor: null, has_more: false } }]);
    const lessons = await new TrainingService(api).listLessons();
    expect(lessons[0]!.order_index).toBe(0);
    expect(lessons[0]!.description).toBeNull();
  });

  it("getLesson returns the single lesson", async () => {
    const { api, calls } = clientWith([{ body: lesson() }]);
    const got = await new TrainingService(api).getLesson("11111111-1111-4111-8111-111111111111");
    expect(got?.code).toBe("L1");
    expect(calls[0]!.url).toContain("/training/lessons/11111111-1111-4111-8111-111111111111");
  });

  it("completeLesson POSTs an idempotency key and never sends a driver id", async () => {
    const { api, calls } = clientWith([
      { body: { id: "e1", driver_id: "d1", lesson_id: "l1", status: "COMPLETED", quiz_score: 90, completed_at: "2026-01-01T00:00:00Z" } },
    ]);
    const enrollment = await new TrainingService(api).completeLesson("l1", 90);
    expect(enrollment.status).toBe("COMPLETED");
    expect(enrollment.quiz_score).toBe(90);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("/training/lessons/l1/complete");
    expect(calls[0]!.body).toEqual({ quiz_score: 90 });
    expect(calls[0]!.headers["idempotency-key"]).toBe("idem-1");
  });

  it("completeLesson omits quiz_score when none is supplied", async () => {
    const { api, calls } = clientWith([{ body: { id: "e1", status: "COMPLETED" } }]);
    await new TrainingService(api).completeLesson("l1");
    expect(calls[0]!.body).toEqual({});
  });

  it("surfaces a domain error rather than swallowing it", async () => {
    const { api } = clientWith([{ status: 403, body: { error_code: "FORBIDDEN", message: "nope" } }]);
    await expect(new TrainingService(api).completeLesson("l1")).rejects.toThrow();
  });

  it("projects the catalogue onto the resource library", async () => {
    const { api } = clientWith([
      {
        body: {
          data: [lesson(), lesson({ id: "x", content_url: "https://cdn.example.com/v.mp4" }), lesson({ id: "y", content_url: null })],
          next_cursor: null,
          has_more: false,
        },
      },
    ]);
    const resources = await new TrainingService(api).listResources();
    expect(resources.map((r) => r.kind)).toEqual(["document", "video", "link"]);
    expect(resources[2]!.url).toBeNull();
    expect(resources[0]!.category).toBe("Safety First");
  });
});

describe("resourceKindFor", () => {
  it("classifies by extension and by known video hosts", () => {
    expect(resourceKindFor("https://x/a.pdf")).toBe("document");
    expect(resourceKindFor("https://x/a.docx?v=2")).toBe("document");
    expect(resourceKindFor("https://x/a.mov")).toBe("video");
    expect(resourceKindFor("https://youtu.be/abc")).toBe("video");
    expect(resourceKindFor("https://x/page")).toBe("link");
    expect(resourceKindFor(null)).toBe("link");
  });
});

describe("lessonToResource", () => {
  it("falls back to the course code when the course has no title", () => {
    const r = lessonToResource(lesson({ course_title: null }) as never);
    expect(r.category).toBe("SAFETY");
  });
});
