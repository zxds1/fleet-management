// packages/worker/src/jobs/transports.ts
// Notification channel transports (N9 / A1.8). Each degrades to a logged no-op when its
// credentials are absent so a dev box or test never needs FCM / Africa's Talking. Real sends
// use fetchWithTimeout (native fetch + AbortController) wrapped in a per-transport circuit breaker
// so a hung or failing downstream is bounded and fails fast into the outbox retry path.

import { logger } from "@fleet/shared";
import type { Env } from "../config/env";
import type { NotificationRow, NotificationTransport, QuietHours, SendResult } from "./notifications";
import { createBreaker, fetchWithTimeout, transportFailureReason } from "../infra/http";

/** Quiet hours in Africa/Nairobi (C6.4). CRITICAL messages break through. */
export function quietHoursEAT(): QuietHours {
  return {
    startHour: 22,
    endHour: 6,
    localHour(now: Date): number {
      const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "numeric", hour12: false });
      return Number(f.format(now)) % 24;
    },
  };
}

export function fcmTransport(env: Env): NotificationTransport {
  // Breaker is created once per transport so its failure stats persist across notification runs.
  const fire = createBreaker(
    (row: NotificationRow) =>
      fetchWithTimeout("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: { Authorization: `key=${env.FCM_SERVER_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: row.recipientAddress,
          notification: { title: row.title, body: row.body },
          data: { ...row.payload, locale: row.locale },
        }),
      }),
    "fcm",
  );
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.FCM_SERVER_KEY) {
        logger.debug("fcm: no server key, skipping", { id: row.id });
        return { status: "SENT", provider: "fcm-skip" };
      }
      try {
        const res = await fire(row);
        const json = (await res.json()) as { message_id?: string };
        return { status: "SENT", provider: "FCM", providerMessageId: json.message_id, deliveredAt: new Date() };
      } catch (e) {
        return { status: "FAILED", failureReason: transportFailureReason("FCM", e) };
      }
    },
  };
}

export function smsTransport(env: Env): NotificationTransport {
  const fire = createBreaker(
    (row: NotificationRow) =>
      fetchWithTimeout("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          apiKey: env.AFRICAS_TALKING_API_KEY ?? "",
        },
        body: new URLSearchParams({
          username: env.AFRICAS_TALKING_USERNAME ?? "",
          to: row.recipientAddress ?? "",
          message: row.body,
          from: env.NOTIFICATION_FROM,
        }).toString(),
      }),
    "africas-talking",
  );
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.AFRICAS_TALKING_USERNAME || !env.AFRICAS_TALKING_API_KEY) {
        logger.debug("sms: no credentials, skipping", { id: row.id });
        return { status: "SENT", provider: "sms-skip" };
      }
      try {
        const res = await fire(row);
        const json = (await res.json()) as { SMSMessageData?: { Recipients?: { messageId?: string }[] } };
        return { status: "SENT", provider: "AFRICAS_TALKING", providerMessageId: json.SMSMessageData?.Recipients?.[0]?.messageId };
      } catch (e) {
        return { status: "FAILED", failureReason: transportFailureReason("SMS", e) };
      }
    },
  };
}

export function emailTransport(env: Env): NotificationTransport {
  const fire = createBreaker(
    (row: NotificationRow) =>
      fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: row.recipientAddress,
          subject: row.title,
          text: row.body,
        }),
      }),
    "email",
  );
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.RESEND_API_KEY) {
        logger.debug("email: no RESEND_API_KEY configured, skipping", { id: row.id, to: row.recipientAddress });
        return { status: "SENT", provider: "email-skip" };
      }
      try {
        await fire(row);
        return { status: "SENT", provider: "EMAIL" };
      } catch (e) {
        return { status: "FAILED", failureReason: transportFailureReason("EMAIL", e) };
      }
    },
  };
}
