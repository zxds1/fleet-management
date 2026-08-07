// packages/worker/test/notifications.test.ts
import { NotificationsJob, type NotificationRow, type NotificationRepository, type NotificationTransport, type QuietHours } from "../src/jobs/notifications";

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    templateCode: null,
    recipientUserId: "u1",
    recipientAddress: "+123",
    channel: "SMS",
    priority: "NORMAL",
    locale: "en",
    title: "t",
    body: "b",
    payload: {},
    incidentKind: null,
    incidentId: null,
    dedupeKey: null,
    ...over,
  };
}

const quietAlways: QuietHours = { startHour: 0, endHour: 6, localHour: () => 2 };

describe("NotificationsJob (C6.4 / A1.8)", () => {
  it("suppresses non-critical during quiet hours", async () => {
    const repo: NotificationRepository = {
      nextBatch: async () => [row()],
      countSmsInWindow: async () => 0,
      markSent: async () => {},
      markFailed: async () => {},
      markSuppressed: async () => {},
    };
    const sent = jest.fn(async () => ({ status: "SENT" as const }));
    const transport: NotificationTransport = { send: sent };
    const result = await new NotificationsJob(repo, { SMS: transport }, quietAlways).run();
    expect(result.suppressed).toBe(1);
    expect(sent).not.toHaveBeenCalled();
  });

  it("lets CRITICAL through quiet hours", async () => {
    const repo: NotificationRepository = {
      nextBatch: async () => [row({ priority: "CRITICAL" })],
      countSmsInWindow: async () => 0,
      markSent: async () => {},
      markFailed: async () => {},
      markSuppressed: async () => {},
    };
    const transport: NotificationTransport = { send: async () => ({ status: "SENT" }) };
    const result = await new NotificationsJob(repo, { SMS: transport }, quietAlways).run();
    expect(result.sent).toBe(1);
  });

  it("enforces the SMS per-incident cap", async () => {
    const repo: NotificationRepository = {
      nextBatch: async () => [row({ channel: "SMS", incidentId: "i1", incidentKind: "ACCIDENT" })],
      countSmsInWindow: async () => 5,
      markSent: async () => {},
      markFailed: async () => {},
      markSuppressed: async () => {},
    };
    const transport: NotificationTransport = { send: async () => ({ status: "SENT" }) };
    const result = await new NotificationsJob(repo, { SMS: transport }, { startHour: 0, endHour: 0, localHour: () => 12 }).run();
    expect(result.suppressed).toBe(1);
  });

  it("sends and marks delivered via the transport", async () => {
    const markSent = jest.fn(async () => {});
    const repo: NotificationRepository = {
      nextBatch: async () => [row({ channel: "PUSH" })],
      countSmsInWindow: async () => 0,
      markSent,
      markFailed: async () => {},
      markSuppressed: async () => {},
    };
    const transport: NotificationTransport = { send: async () => ({ status: "SENT", provider: "FCM", providerMessageId: "m1", deliveredAt: new Date() }) };
    const result = await new NotificationsJob(repo, { PUSH: transport }, { startHour: 0, endHour: 0, localHour: () => 12 }).run();
    expect(result.sent).toBe(1);
    expect(markSent).toHaveBeenCalledWith("n1", "FCM", "m1", expect.any(Date));
  });
});
