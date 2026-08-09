// packages/api/src/services/notifications.ts
// Notification inbox service (C6.4). Delivery itself is worker/outbox-driven; this service only
// exposes the recipient-facing read + acknowledge surface. Every operation is scoped to the calling
// principal's user id, which is passed in from the resolved principal and never taken from the
// request, so one user can never read or acknowledge another's notifications.
//
// Returns Result<T> and never throws for a domain rule (08 §1). Reads are keyset paginated (D7).

import { type Result, type Tx, ok, err, NotFound } from "@fleet/shared";
import type { NotificationRow } from "@fleet/shared";
import { MAX_PAGE_LIMIT, decodeCursor, buildPage, type CursorPage } from "../http/pagination";
import type { NotificationInboxRow, NotificationRepository } from "../repositories/notifications";

export class NotificationService {
  constructor(private readonly notifications: NotificationRepository) {}

  /** The caller's own inbox, newest first. Keyset on (queued_at, id) DESC. */
  async listForUser(
    userId: string,
    opts: { limit: number; cursor?: string | null },
  ): Promise<Result<CursorPage<NotificationInboxRow>>> {
    const limit = Math.min(Math.max(opts.limit, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(opts.cursor ?? undefined);
    const rows = await this.notifications.listForRecipient(userId, {
      limit: limit + 1,
      ...(cursor ? { cursorSort: cursor.sort, cursorId: cursor.id } : {}),
    });
    return ok(buildPage(rows, limit, (row) => ({ sort: String(row.created_at ?? ""), id: row.id })));
  }

  /**
   * Acknowledges a notification by flipping it to DELIVERED. Scoped to the recipient, so a
   * notification belonging to someone else is indistinguishable from one that does not exist
   * (404) — this deliberately avoids leaking the existence of another user's notification.
   *
   * Acknowledging an already-DELIVERED row is a no-op that still returns 200, so an offline retry
   * behaves identically to the first call.
   */
  async markRead(
    tx: Tx,
    id: string,
    userId: string,
  ): Promise<Result<{ id: string; status: NotificationRow["status"]; delivered_at: string | null }>> {
    const existing = await this.notifications.findForRecipient(id, userId);
    if (!existing) return err(new NotFound("Notification not found"));

    const row = await this.notifications.markDelivered(id, userId);
    if (!row) return err(new NotFound("Notification not found"));

    tx.registerOutbox({
      event_type: "notification.acknowledged",
      aggregate_type: "notification",
      aggregate_id: row.id,
      payload: { id: row.id, recipient_user_id: userId },
    });

    return ok({ id: row.id, status: row.status, delivered_at: row.delivered_at });
  }
}
