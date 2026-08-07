// packages/worker/test/escalation.test.ts
import { planEscalation, EscalationJob, MAX_TIER, type EscalationRepository, type EscalationTimerRow } from "../src/jobs/escalation";

describe("planEscalation (C6.3)", () => {
  const timer: EscalationTimerRow = { id: "t1", incidentKind: "ACCIDENT", incidentId: "a1", tier: 1 };

  it("pages the next roster tier and re-arms", () => {
    const plan = planEscalation(timer, "u-tier2", "u-head", 5);
    expect(plan.notify.recipientUserId).toBe("u-tier2");
    expect(plan.nextTierInMinutes).toBe(5);
    expect(plan.markAccidentEscalatedTo).toBe("u-tier2");
  });

  it("falls back to Head of Ops at max tier", () => {
    const top: EscalationTimerRow = { ...timer, tier: MAX_TIER };
    const plan = planEscalation(top, null, "u-head", 5);
    expect(plan.notify.recipientUserId).toBe("u-head");
    expect(plan.nextTierInMinutes).toBeNull();
    expect(plan.notify.title).toContain(`tier ${MAX_TIER + 1}`);
  });
});

class FakeEscalationRepo implements EscalationRepository {
  due: EscalationTimerRow[];
  enqueued: any[] = [];
  armed: any[] = [];
  fired: string[] = [];
  accidents: Record<string, string> = {};
  constructor(due: EscalationTimerRow[]) {
    this.due = due;
  }
  dueTimers() {
    return Promise.resolve(this.due);
  }
  rosterFor() {
    return Promise.resolve("u-tier2");
  }
  headOfOperations() {
    return Promise.resolve("u-head");
  }
  markFired(id: string) {
    this.fired.push(id);
    return Promise.resolve();
  }
  enqueueNotification(n: any) {
    this.enqueued.push(n);
    return Promise.resolve();
  }
  armNextTier(timer: EscalationTimerRow, minutes: number) {
    this.armed.push({ tier: timer.tier + 1, minutes });
    return Promise.resolve();
  }
  markAccidentEscalated(incidentId: string, _at: Date, to: string) {
    this.accidents[incidentId] = to;
    return Promise.resolve();
  }
}

describe("EscalationJob.run", () => {
  it("fires due timers, pages next tier, re-arms and marks accident", async () => {
    const repo = new FakeEscalationRepo([{ id: "t1", incidentKind: "ACCIDENT", incidentId: "a1", tier: 1 }]);
    const job = new EscalationJob(repo, { numeric: async () => 5 } as any);
    const res = await job.run(new Date("2026-01-01T12:00:00Z"));
    expect(res.fired).toBe(1);
    expect(repo.enqueued).toHaveLength(1);
    expect(repo.armed).toEqual([{ tier: 2, minutes: 5 }]);
    expect(repo.accidents["a1"]).toBe("u-tier2");
  });
});
