// packages/api/test/status.endpoints.test.ts
// Unit tests for the four status endpoints the mobile client fetches from the backend. No DB: the
// repositories are hand-rolled fakes (convention in inspections.service.test.ts / onboarding.service.test.ts).
// Assertions are on the contract shape — and each response is validated against the matching
// @fleet/shared zod schema so the runtime contract cannot drift from api/openapi.yaml.

import {
  ConsentStatusSchema,
  TrainingStatusSchema,
  DriverAssignmentSchema,
} from "@fleet/shared";
import { ConsentService } from "../src/services/consent";
import { TrainingService } from "../src/services/training";
import { NotificationService } from "../src/services/notifications";
import { toDriverAssignmentResponse } from "../src/http/routes/onboarding";
import type { ActiveDriverAssignmentRow } from "../src/repositories/shifts";

describe("ConsentService.getStatus", () => {
  it("reports consented + current version when an accepted record exists", async () => {
    const consents = { findAccepted: async () => ({ policy_version: "2026.1" }) } as any;
    const svc = new ConsentService(consents);
    const status = await svc.getStatus("u1", "2026.1");
    expect(status).toEqual({ consented: true, current_version: "2026.1", required_version: "2026.1" });
    expect(() => ConsentStatusSchema.parse(status)).not.toThrow();
  });

  it("reports not consented (current_version null) when no accepted record", async () => {
    const consents = { findAccepted: async () => null } as any;
    const svc = new ConsentService(consents);
    const status = await svc.getStatus("u1", "2026.1");
    expect(status).toEqual({ consented: false, current_version: null, required_version: "2026.1" });
    expect(() => ConsentStatusSchema.parse(status)).not.toThrow();
  });
});

describe("TrainingService.trainingStatus", () => {
  it("returns completed/total and all_complete=false when some remain", async () => {
    const enrollments = { getStatus: async () => ({ completedLessonIds: ["L1"], totalLessons: 3 }) } as any;
    const svc = new TrainingService({} as any, enrollments);
    const status = await svc.trainingStatus("d1");
    expect(status).toEqual({ completed_lessons: ["L1"], total_lessons: 3, all_complete: false });
    expect(() => TrainingStatusSchema.parse(status)).not.toThrow();
  });

  it("is all_complete when every lesson is done", async () => {
    const enrollments = {
      getStatus: async () => ({ completedLessonIds: ["L1", "L2", "L3"], totalLessons: 3 }),
    } as any;
    const svc = new TrainingService({} as any, enrollments);
    const status = await svc.trainingStatus("d1");
    expect(status.all_complete).toBe(true);
  });
});

describe("NotificationService.markAllRead", () => {
  it("marks all owned notifications read and returns ok", async () => {
    let captured: string | null = null;
    const repo = { markAllDelivered: async (userId: string) => { captured = userId; return 2; } } as any;
    const svc = new NotificationService(repo);
    const result = await svc.markAllRead("u1");
    expect(result.ok).toBe(true);
    expect(captured).toBe("u1");
  });
});

describe("driver assignment response mapping (GET /drivers/me/assignment)", () => {
  const row: ActiveDriverAssignmentRow = {
    assignment_id: "11111111-1111-4111-8111-111111111111",
    vehicle_id: "22222222-2222-4222-8222-222222222222",
    status: "ACTIVE",
    starts_at: null,
    ends_at: null,
  };

  it("maps an active assignment onto the contract shape", () => {
    const view = toDriverAssignmentResponse(row);
    expect(view).toEqual({
      assignment_id: "11111111-1111-4111-8111-111111111111",
      vehicle_id: "22222222-2222-4222-8222-222222222222",
      status: "ACTIVE",
      starts_at: null,
      ends_at: null,
    });
    expect(() => DriverAssignmentSchema.parse(view)).not.toThrow();
  });

  it("returns null when there is no active assignment (route emits 404 NO_ASSIGNMENT)", () => {
    expect(toDriverAssignmentResponse(null)).toBeNull();
  });
});
