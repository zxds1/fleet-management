// packages/api/src/repositories/notifications.ts
// Notification repository (09_audit_notifications.sql). Parameterised SQL only; no business rules
// (06 §2). `app.notifications` is append-and-receipt: rows are never soft-deleted, so the
// deletedAtColumn is disabled explicitly. Every read is scoped by recipient_user_id in SQL so a
// principal can never see another user's inbox (06 §2.7).

import { BaseRepository } from "@fleet/db";
import { notificationUnreadSql, type DbClient, type NotificationRow } from "@fleet/shared";

/** Inbox read model for `GET /notifications` (C6.4). Aliases match the DTO field names exactly. */
export interface NotificationInboxRow {
  id: string;
  title: string;
  body: string;
  priority: NotificationRow["priority"];
  status: NotificationRow["status"];
  created_at: string;
  payload: unknown;
}

export class NotificationRepository extends BaseRepository<NotificationRow> {
  constructor(client: DbClient) {
    super(client, "app.notifications", { deletedAtColumn: null });
  }

  /**
   * The caller's own inbox, keyset paginated on (queued_at, id) DESC. Always scoped to
   * `recipient_user_id` in SQL. Fetches limit + 1 so `has_more` needs no COUNT.
   */
  async listForRecipient(
    userId: string,
    opts: { limit: number; cursorSort?: string; cursorId?: string },
  ): Promise<NotificationInboxRow[]> {
    const params: unknown[] = [userId];
    let keyset = "";
    if (opts.cursorSort && opts.cursorId) {
      params.push(opts.cursorSort, opts.cursorId);
      keyset = `AND (n.queued_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(opts.limit);
    const res = await this.client.query<NotificationInboxRow>(
      `SELECT n.id        AS id,
              n.title     AS title,
              n.body      AS body,
              n.priority  AS priority,
              n.status    AS status,
              n.queued_at AS created_at,
              n.payload   AS payload
         FROM app.notifications n
        WHERE n.recipient_user_id = $1::uuid ${keyset}
        ORDER BY n.queued_at DESC, n.id DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  }

  /** Single notification, scoped to the recipient so a foreign id reads as "not found". */
  async findForRecipient(id: string, userId: string): Promise<NotificationRow | null> {
    const res = await this.client.query<NotificationRow>(
      `SELECT * FROM app.notifications
        WHERE id = $1::uuid AND recipient_user_id = $2::uuid
        LIMIT 1`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Acknowledge: flips the row to DELIVERED and stamps delivered_at, scoped to the recipient.
   * Already-DELIVERED rows keep their original delivered_at so a replay is a genuine no-op.
   */
  async markDelivered(id: string, userId: string): Promise<NotificationRow | null> {
    const res = await this.client.query<NotificationRow>(
      `UPDATE app.notifications
          SET status       = 'DELIVERED',
              delivered_at = COALESCE(delivered_at, now())
        WHERE id = $1::uuid AND recipient_user_id = $2::uuid
        RETURNING *`,
      [id, userId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Badge counts (S-08). The cursor page deliberately fetches `limit + 1` so `has_more` needs no COUNT,
   * which left the client showing "50+" as a lower bound. Two cheap indexed counts close that.
   *
   * UNREAD comes from the shared predicate (`notificationUnreadSql`), which is the same one the
   * gateway uses for its reconnect snapshot — so the badge and the inbox agree by construction
   * rather than by two hand-written lists that happened to match. `app.notifications` is
   * append-and-receipt, so there is no `deleted_at` predicate here (see the file header).
   */
  async countForUser(userId: string): Promise<{ total: number; unread: number }> {
    const res = await this.client.query<{ total: string; unread: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE ${notificationUnreadSql()})::text AS unread
         FROM app.notifications
        WHERE recipient_user_id = $1::uuid`,
      [userId],
    );
    return { total: Number(res.rows[0]?.total ?? 0), unread: Number(res.rows[0]?.unread ?? 0) };
  }

  /**
   * Marks every unread (non-DELIVERED) notification for the recipient as DELIVERED, scoped to the
   * recipient so one user can never touch another's inbox. Returns the number of rows changed.
   * Backs `POST /notifications/read-all` (204 No Content); the client refetches `GET /notifications`.
   */
  async markAllDelivered(userId: string): Promise<number> {
    const res = await this.client.query(
      `UPDATE app.notifications
          SET status       = 'DELIVERED',
              delivered_at = COALESCE(delivered_at, now())
        WHERE recipient_user_id = $1::uuid AND status <> 'DELIVERED'`,
      [userId],
    );
    return res.rowCount ?? 0;
  }
}
