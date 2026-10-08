// packages/shared/src/notifications.ts
// The ONE definition of "unread" for app.notifications, shared by the REST badge count
// (packages/api/src/repositories/notifications.ts) and the realtime gateway's reconnect snapshot
// (packages/ws/src/repositories/views.ts). Both used to spell the predicate separately and drift:
// the REST side named 'READ' and 'SUPPRESSED', neither of which is a member of
// app.notification_status (db/schema/01_enums.sql), so the badge could not plan at all.
//
// Semantics are the gateway's existing ones, unchanged: DELIVERED is the state the recipient-ack
// routes write, so a notification is unread until the recipient acknowledges it. QUEUED and SENT
// (awaiting provider delivery) are unread too — a notification nobody has received yet is still
// outstanding. Expressed as an exclusion so a future enum value is unread by default rather than
// silently counted as read.

/** Statuses that do NOT count as unread. Any status added later is unread until listed here. */
export const NOTIFICATION_READ_STATUSES = ["DELIVERED", "SUPPRESSED_DND"] as const;

/** `status IN ('QUEUED','SENT','DELIVERED')` — the exact complement of the exclusion above. */
export const NOTIFICATION_UNREAD_STATUSES = ["QUEUED", "SENT", "DELIVERED"] as const;

/** Renders `status IN (…)` for a single-quoted SQL literal list. */
function sqlList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

/**
 * SQL predicate selecting a user's UNREAD notifications. `alias` is the table alias in use.
 * Parameterless on purpose: it is a closed enum set, never caller input.
 */
export function notificationUnreadSql(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `${a}status IN (${sqlList(NOTIFICATION_UNREAD_STATUSES)})`;
}

/** SQL predicate selecting a user's notifications that are NOT unread (the exclusion form). */
export function notificationReadSql(alias = ""): string {
  const a = alias ? `${alias}.` : "";
  return `${a}status NOT IN (${sqlList(NOTIFICATION_READ_STATUSES)})`;
}