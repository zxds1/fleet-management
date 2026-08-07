// packages/worker/src/jobs/notifications.ts
// `notifications` job (05 §2 #1, §5). Drains app.notifications QUEUED rows, sends each via the
// right channel, and records delivery. Honours quiet hours (C6.4 — CRITICAL breaks through) and
// the A1.8 SMS cap (5 per incident per 15 min). Designed around injected transports so it is
// fully unit-testable without FCM/Africa's Talking.

export type NotificationChannel = "PUSH" | "SMS" | "EMAIL";
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface NotificationRow {
  id: string;
  templateCode: string | null;
  recipientUserId: string | null;
  recipientAddress: string | null;
  channel: NotificationChannel;
  priority: NotificationPriority;
  locale: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  incidentKind: string | null;
  incidentId: string | null;
  dedupeKey: string | null;
}

export interface SendResult {
  status: "SENT" | "FAILED";
  provider?: string;
  providerMessageId?: string;
  deliveredAt?: Date;
  failureReason?: string;
}

export interface NotificationTransport {
  send(row: NotificationRow): Promise<SendResult>;
}

export interface NotificationRepository {
  nextBatch(limit: number): Promise<NotificationRow[]>;
  countSmsInWindow(incidentId: string, since: Date): Promise<number>;
  markSent(id: string, provider: string | undefined, messageId: string | undefined, deliveredAt: Date): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  markSuppressed(id: string, reason: string): Promise<void>;
}

export interface QuietHours {
  /** Inclusive start/end local hours (24h). e.g. 22 → 6 means 22:00–06:00 suppressed. */
  startHour: number;
  endHour: number;
  /** Returns local hour in the fleet timezone for a given instant. */
  localHour(now: Date): number;
}

const SMS_WINDOW_MS = 15 * 60_000;
const SMS_CAP = 5;

export interface NotificationsJobResult {
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
}

export class NotificationsJob {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly transports: Partial<Record<NotificationChannel, NotificationTransport>>,
    private readonly quietHours: QuietHours,
    private readonly now: Date = new Date(),
  ) {}

  private inQuietHours(): boolean {
    const h = this.quietHours.localHour(this.now);
    const { startHour, endHour } = this.quietHours;
    if (startHour === endHour) return false;
    if (startHour < endHour) return h >= startHour && h < endHour;
    return h >= startHour || h < endHour; // wraps midnight
  }

  async run(batchSize = 50): Promise<NotificationsJobResult> {
    const rows = await this.repo.nextBatch(batchSize);
    const result: NotificationsJobResult = { processed: rows.length, sent: 0, failed: 0, suppressed: 0 };

    for (const row of rows) {
      // C6.4: non-critical messages are suppressed during quiet hours.
      if (row.priority !== "CRITICAL" && this.inQuietHours()) {
        await this.repo.markSuppressed(row.id, "DND_QUIET_HOURS");
        result.suppressed++;
        continue;
      }

      // A1.8: SMS rate-limit per incident per 15 minutes.
      if (row.channel === "SMS" && row.incidentId) {
        const count = await this.repo.countSmsInWindow(row.incidentId, new Date(this.now.getTime() - SMS_WINDOW_MS));
        if (count >= SMS_CAP) {
          await this.repo.markSuppressed(row.id, "SMS_RATE_LIMIT");
          result.suppressed++;
          continue;
        }
      }

      const transport = this.transports[row.channel];
      if (!transport) {
        await this.repo.markFailed(row.id, `NO_TRANSPORT:${row.channel}`);
        result.failed++;
        continue;
      }

      const res = await transport.send(row);
      if (res.status === "SENT") {
        await this.repo.markSent(row.id, res.provider, res.providerMessageId, res.deliveredAt ?? this.now);
        result.sent++;
      } else {
        await this.repo.markFailed(row.id, res.failureReason ?? "UNKNOWN");
        result.failed++;
      }
    }
    return result;
  }
}
