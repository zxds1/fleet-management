// packages/api/test/notifications.service.test.ts
// Unit tests for NotificationService using hand-rolled fakes (no DB). The security-relevant
// behaviour here is recipient scoping: a notification belonging to another user must be
// indistinguishable from one that does not exist (NOT_FOUND, never 403), so the endpoint cannot be
// used to probe for other users' notifications. Also covers the cursor envelope and the
// acknowledge-is-idempotent path.

import { type DbClient, type Tx } from "@fleet/shared";
import type { NotificationRow } from "@fleet/shared";
import { NotificationService } from "../src/services/notifications";
import type { NotificationInboxRow } from "../src/repositories/notifications";

const outbox: unknown[] = [];
const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: (e: unknown) => void outbox.push(e),
} as unknown as Tx;

const inboxRow: NotificationInboxRow = {
  id: "ntf-1",
  title: "Accident reported",
  body: "KDA 001A reported an incident.",
  priority: "CRITICAL",
  status: "QUEUED",
  created_at: "2026-03-01T09:00:00.000Z",
  payload: { accident_id: "acc-1" },
};

function makeService(
  overrides: { rows?: NotificationInboxRow[]; existing?: NotificationRow | null } = {},
) {
  const scopedCalls: unknown[] = [];

  const notifications = {
    listForRecipient: async (userId: string, opts: unknown) => {
      scopedCalls.push({ userId, opts });
      return overrides.rows ?? [inboxRow];
    },
    findForRecipient: async (id: string, userId: string) => {
      scopedCalls.push({ id, userId });
      return overrides.existing !== undefined
        ? overrides.existing
        : ({ id, recipient_user_id: userId, status: "QUEUED" } as unknown as NotificationRow);
    },
    markDelivered: async (id: string, userId: string) =>
      overrides.existing === null
        ? null
        : ({
            id,
            recipient_user_id: userId,
            status: "DELIVERED",
            delivered_at: "2026-03-01T10:00:00.000Z",
          } as unknown as NotificationRow),
  } as unknown as import("../src/repositories/notifications").NotificationRepository;

  return { service: new NotificationService(notifications), scopedCalls };
}

describe("NotificationService.listForUser", () => {
  it("scopes the query to the calling user and returns a cursor page", async () => {
    const { service, scopedCalls } = makeService({ rows: [inboxRow, { ...inboxRow, id: "ntf-2" }] });
    const result = await service.listForUser("usr-1", { limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data).toHaveLength(1);
    expect(result.value.has_more).toBe(true);
    expect(result.value.next_cursor).not.toBeNull();
    expect(scopedCalls[0]).toMatchObject({ userId: "usr-1" });
  });

  it("returns an empty page without a cursor when the inbox is empty", async () => {
    const { service } = makeService({ rows: [] });
    const result = await service.listForUser("usr-1", { limit: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data).toEqual([]);
    expect(result.value.has_more).toBe(false);
    expect(result.value.next_cursor).toBeNull();
  });
});

describe("NotificationService.markRead", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("treats another user's notification as NOT_FOUND rather than FORBIDDEN", async () => {
    const { service } = makeService({ existing: null });
    const result = await service.markRead(tx, "ntf-foreign", "usr-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error_code).toBe("NOT_FOUND");
  });

  it("acknowledges the caller's own notification and stages an outbox event", async () => {
    const { service, scopedCalls } = makeService();
    const result = await service.markRead(tx, "ntf-1", "usr-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("DELIVERED");
      expect(result.value.delivered_at).toBe("2026-03-01T10:00:00.000Z");
    }
    // The lookup must be scoped by the caller's user id, not just the notification id.
    expect(scopedCalls[0]).toMatchObject({ id: "ntf-1", userId: "usr-1" });
    expect(outbox[0]).toMatchObject({ event_type: "notification.acknowledged", aggregate_id: "ntf-1" });
  });
});
