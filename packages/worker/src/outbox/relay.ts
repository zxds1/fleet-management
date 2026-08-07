// packages/worker/src/outbox/relay.ts
// Outbox relay wiring (05 §1, D8). Drains app.outbox_events and routes each event_type to the
// owning job. Handlers are idempotent (at-least-once, 01 §6). Side effects (notifications,
// accident freeze, OCR, reconciliation) all funnel through here so no request transaction ever
// calls an external service inline.

import { transaction } from "@fleet/db";
import { logger, RealtimeChannels, type EventPublisher } from "@fleet/shared";
import { PgOutboxRelay } from "@fleet/db";
import type { PoolLike, OutboxEvent } from "@fleet/shared";
import type { ConfigClient } from "@fleet/shared";
import type { Env } from "../config/env";
import type { VisionAdapter } from "../jobs/ocr";
import type { CsvParser } from "../jobs/reconciliation";
import { AccidentFreezeJob } from "../jobs/accident-freeze";
import { OcrJob } from "../jobs/ocr";
import { ReconciliationJob } from "../jobs/reconciliation";
import { PgEscalationRepository, enqueueNotification } from "../jobs/pg";

export interface RelayInfra {
  pool: PoolLike;
  config: ConfigClient;
  env: Env;
  vision: VisionAdapter;
  parser: CsvParser;
  /** Publishes real-time events to the @fleet/ws gateway (07 §3/§5). */
  publisher: EventPublisher;
}

export function createOutboxRelay(pool: PoolLike, env: Env): PgOutboxRelay {
  return new PgOutboxRelay(pool, {
    intervalMs: env.OUTBOX_INTERVAL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  });
}

export function registerHandlers(relay: PgOutboxRelay, infra: RelayInfra): void {
  relay.registerHandler("accident.escalate", async (ev: OutboxEvent) => {
    const reportId = String(ev.payload.id);
    const now = new Date();
    const freeze = new AccidentFreezeJob(infra.pool, infra.config);
    await freeze.run(reportId, now);

    const escRepo = new PgEscalationRepository(await infra.pool.connect(), infra.config);
    const tier1 = await escRepo.rosterFor("ACCIDENT", 1);
    const ackTimeout = await infra.config.numeric("accident.ack_timeout_minutes");
    let notif: Awaited<ReturnType<typeof enqueueNotification>> | undefined;
    await transaction(infra.pool, async (tx) => {
      if (tier1) {
        notif = await enqueueNotification(tx.client, {
          recipientUserId: tier1,
          channel: "PUSH",
          priority: "HIGH",
          title: "Accident escalation",
          body: `Accident ${reportId} requires acknowledgement.`,
          incidentKind: "ACCIDENT",
          incidentId: reportId,
        });
      }
      await tx.client.query(
        `INSERT INTO app.escalation_timers (incident_kind, incident_id, tier, fires_at)
         VALUES ('ACCIDENT',$1,1,$2)
         ON CONFLICT (incident_kind, incident_id, tier) DO NOTHING`,
        [reportId, new Date(now.getTime() + ackTimeout * 60_000)],
      );
    });
    // Real-time: page the on-call roster + surface the escalation notification (07 §4).
    infra.publisher.publish(RealtimeChannels.accidentLive, {
      reportId,
      mayday: Boolean(ev.payload.mayday),
      driverId: ev.payload.driverId,
      vehicleId: ev.payload.vehicleId,
    });
    if (notif?.recipient_user_id) {
      infra.publisher.publish(RealtimeChannels.notifications, { userId: notif.recipient_user_id, notification: notif });
    }
  });

  relay.registerHandler("accident.created", async (ev: OutboxEvent) => {
    // Non-mayday report creation still pushes to the on-call roster (07 §3, 08 §3).
    infra.publisher.publish(RealtimeChannels.accidentLive, {
      reportId: String(ev.payload.id),
      mayday: false,
      driverId: ev.payload.driverId,
      vehicleId: ev.payload.vehicleId,
    });
  });

  relay.registerHandler("fuel.ocr", async () => {
    await new OcrJob(infra.pool, infra.vision).run();
  });

  relay.registerHandler("reconciliation.statement", async (ev: OutboxEvent) => {
    const mediaObjectId = String(ev.payload.mediaObjectId ?? ev.payload.id);
    await new ReconciliationJob(infra.pool, infra.parser).run(mediaObjectId);
  });

  relay.registerHandler("inspection.submitted", async (ev: OutboxEvent) => {
    let notif: Awaited<ReturnType<typeof enqueueNotification>> | undefined;
    await transaction(infra.pool, async (tx) => {
      notif = await enqueueNotification(tx.client, {
        recipientUserId: null,
        channel: "PUSH",
        priority: "NORMAL",
        title: "DVIR submitted",
        body: `Inspection ${ev.payload.inspectionId} submitted for review.`,
      });
    });
    if (notif?.recipient_user_id) {
      infra.publisher.publish(RealtimeChannels.notifications, { userId: notif.recipient_user_id, notification: notif });
    }
  });

  // shift.started / shift.closed / trailer.swap change the derived vehicle display state — nudge the
  // gateway to recompute + diff the live map (07 §3/§5). The payload is unused; the gateway re-reads
  // the view.
  for (const type of ["shift.started", "shift.closed", "trailer.swap"]) {
    relay.registerHandler(type, async () => {
      await infra.publisher.publish(RealtimeChannels.vehicleStates, { reason: type });
    });
  }
}
