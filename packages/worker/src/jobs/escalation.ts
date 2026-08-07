// packages/worker/src/jobs/escalation.ts
// `escalation` job (05 §2 #2, C6.3). Fires due escalation_timers (five-minute accident
// acknowledgement window). Each fired timer notifies the next on-call tier (or the Head of
// Operations from system_config once the roster is exhausted) and arms the next tier's timer.

import type { ConfigClient } from "@fleet/shared";
import { logger } from "@fleet/shared";

export const MAX_TIER = 5;

export interface EscalationTimerRow {
  id: string;
  incidentKind: string;
  incidentId: string;
  tier: number;
}

export interface EscalationPlan {
  /** Notification to enqueue for the target of this escalation. */
  notify: { recipientUserId: string | null; title: string; body: string; incidentKind: string; incidentId: string };
  /** If set, arm the next tier's timer this many minutes from `now`. */
  nextTierInMinutes: number | null;
  /** When the incident is an accident, mark it escalated to this user. */
  markAccidentEscalatedTo: string | null;
}

export interface EscalationRepository {
  dueTimers(now: Date): Promise<EscalationTimerRow[]>;
  rosterFor(incidentKind: string, tier: number): Promise<string | null>;
  headOfOperations(): Promise<string | null>;
  markFired(id: string, at: Date): Promise<void>;
  enqueueNotification(input: EscalationPlan["notify"], priority: "HIGH" | "CRITICAL"): Promise<void>;
  armNextTier(timer: EscalationTimerRow, inMinutes: number, at: Date): Promise<void>;
  markAccidentEscalated(incidentId: string, at: Date, escalatedTo: string): Promise<void>;
}

/** Pure decision: who to page and whether to re-arm. */
export function planEscalation(
  timer: EscalationTimerRow,
  rosterUserId: string | null,
  headOfOpsUserId: string | null,
  ackTimeoutMinutes: number,
): EscalationPlan {
  const nextTier = timer.tier + 1;
  const useRoster = timer.tier < MAX_TIER;
  const target = useRoster ? rosterUserId : headOfOpsUserId;
  return {
    notify: {
      recipientUserId: target,
      title: `Escalation: ${timer.incidentKind} (tier ${nextTier})`,
      body: `Incident ${timer.incidentId} not acknowledged — escalating to tier ${nextTier}.`,
      incidentKind: timer.incidentKind,
      incidentId: timer.incidentId,
    },
    nextTierInMinutes: nextTier <= MAX_TIER ? ackTimeoutMinutes : null,
    markAccidentEscalatedTo: timer.incidentKind === "ACCIDENT" ? target : null,
  };
}

export class EscalationJob {
  constructor(private readonly repo: EscalationRepository, private readonly config: ConfigClient) {}

  async run(now: Date = new Date()): Promise<{ fired: number }> {
    const timers = await this.repo.dueTimers(now);
    const ackTimeout = await this.config.numeric("accident.ack_timeout_minutes");
    let fired = 0;

    for (const timer of timers) {
      const rosterUserId = timer.tier < MAX_TIER ? await this.repo.rosterFor(timer.incidentKind, timer.tier + 1) : null;
      const headOfOps = await this.repo.headOfOperations();
      const plan = planEscalation(timer, rosterUserId, headOfOps, ackTimeout);

      if (!plan.notify.recipientUserId) {
        logger.warn("escalation: no target resolved", { incidentKind: timer.incidentKind, incidentId: timer.incidentId });
      } else {
        await this.repo.enqueueNotification(plan.notify, timer.tier >= MAX_TIER ? "CRITICAL" : "HIGH");
      }
      if (plan.markAccidentEscalatedTo) {
        await this.repo.markAccidentEscalated(timer.incidentId, now, plan.markAccidentEscalatedTo);
      }
      if (plan.nextTierInMinutes != null) {
        await this.repo.armNextTier(timer, plan.nextTierInMinutes, now);
      }
      await this.repo.markFired(timer.id, now);
      fired++;
    }
    return { fired };
  }
}
