// packages/worker/src/jobs/scheduler.ts
// Scheduled job registry (05 §2). Builds the 13 jobs at their documented cadences and runs them
// on intervals. The outbox relay (outbox/relay.ts) drains event-driven work separately.

import { logger } from "@fleet/shared";
import type { PoolLike, ConfigClient, EventPublisher } from "@fleet/shared";
import type { Env } from "../config/env";
import type { VisionAdapter } from "./ocr";
import type { CsvParser } from "./reconciliation";
import { NotificationsJob, type NotificationTransport } from "./notifications";
import { PgNotificationRepository } from "./pg";
import { EscalationJob } from "./escalation";
import { PgEscalationRepository } from "./pg";
import { HosRecomputeJob } from "./hos-recompute";
import { FuelAnomalyJob } from "./fuel-anomaly";
import { PgFuelAnomalyRepository } from "./pg";
import { DocumentExpiryJob } from "./document-expiry";
import { MaintenanceEvalJob } from "./maintenance-eval";
import { StaleShiftJob } from "./stale-shift";
import { EfficiencyBaselineJob } from "./efficiency-baseline";
import { PartitionMaintJob } from "./partition-maint";
import { RetentionJob } from "./retention";
import { OcrJob } from "./ocr";
import { quietHoursEAT, fcmTransport, smsTransport, emailTransport } from "./transports";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export function buildSchedule(
  pool: PoolLike,
  config: ConfigClient,
  env: Env,
  vision: VisionAdapter,
  publisher?: EventPublisher,
): ScheduledJob[] {
  const transports: Partial<Record<"PUSH" | "SMS" | "EMAIL", NotificationTransport>> = {
    PUSH: fcmTransport(env),
    SMS: smsTransport(env),
    EMAIL: emailTransport(env),
  };

  return [
    {
      name: "notifications",
      intervalMs: 5_000,
      run: async () => {
        await transactionRun(pool, async (client) => {
          const job = new NotificationsJob(new PgNotificationRepository(client), transports, quietHoursEAT());
          await job.run();
        });
      },
    },
    {
      name: "escalation",
      intervalMs: 60_000,
      run: async () => {
        await transactionRun(pool, async (client) => {
          const job = new EscalationJob(new PgEscalationRepository(client, config), config);
          await job.run();
        });
      },
    },
    {
      name: "hos-recompute",
      intervalMs: 5 * 60_000,
      run: async () => {
        await new HosRecomputeJob(pool, config, publisher).run();
      },
    },
    {
      name: "fuel-anomaly",
      intervalMs: 5 * 60_000,
      run: async () => {
        const cfg = {
          anomalyGaugeDeviationPct: await config.numeric("fuel.anomaly_gauge_deviation_pct"),
          efficiencyDeviationPct: await config.numeric("fuel.efficiency_deviation_pct"),
          priceOutlierPct: await config.numeric("fuel.price_outlier_pct"),
        };
        await new FuelAnomalyJob(new PgFuelAnomalyRepository(pool), cfg).run();
      },
    },
    {
      name: "ocr",
      intervalMs: 30_000,
      run: async () => {
        await new OcrJob(pool, vision).run();
      },
    },
    {
      name: "maintenance-eval",
      intervalMs: HOUR,
      run: async () => {
        await new MaintenanceEvalJob(pool, config).run();
      },
    },
    {
      name: "stale-shift",
      intervalMs: HOUR,
      run: async () => {
        await new StaleShiftJob(pool, config, publisher).run();
      },
    },
    {
      name: "document-expiry",
      intervalMs: DAY,
      run: async () => {
        await new DocumentExpiryJob(pool, config).run();
      },
    },
    {
      name: "efficiency-baseline",
      intervalMs: DAY,
      run: async () => {
        await new EfficiencyBaselineJob(pool, config).run();
      },
    },
    {
      name: "partition-maint",
      intervalMs: DAY,
      run: async () => {
        await new PartitionMaintJob(pool).run();
      },
    },
    {
      name: "retention",
      intervalMs: DAY,
      run: async () => {
        // Dry-run by default; flip to wet in production after sign-off (D6).
        await new RetentionJob(pool, config).run(false);
      },
    },
  ];
}

export class JobScheduler {
  private timers: ReturnType<typeof setInterval>[] = [];
  constructor(private readonly jobs: ScheduledJob[]) {}

  start(): void {
    for (const job of this.jobs) {
      logger.info("scheduling job", { name: job.name, intervalMs: job.intervalMs });
      const t = setInterval(() => {
        job.run().catch((e) => logger.error("job failed", { name: job.name, message: (e as Error).message }));
      }, job.intervalMs);
      if (typeof (t as { unref?: () => void }).unref === "function") (t as { unref: () => void }).unref();
      this.timers.push(t);
      // Kick the first run shortly after boot.
      setTimeout(() => job.run().catch((e) => logger.error("job failed", { name: job.name, message: (e as Error).message })), 1000);
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}

// Run a unit of work inside one transaction, passing the bound client to `fn`.
async function transactionRun(pool: PoolLike, fn: (client: import("@fleet/shared").DbClient) => Promise<void>): Promise<void> {
  const { transaction } = await import("@fleet/db");
  await transaction(pool, async (tx) => {
    await fn(tx.client);
  });
}
