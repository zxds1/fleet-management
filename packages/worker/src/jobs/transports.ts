// packages/worker/src/jobs/transports.ts
// Notification channel transports (N9 / A1.8). Each degrades to a logged no-op when its
// credentials are absent so a dev box or test never needs FCM / Africa's Talking. Real sends
// use global fetch; failures are reported back to the notifications job for retry.

import { logger } from "@fleet/shared";
import type { Env } from "../config/env";
import type { NotificationRow, NotificationTransport, QuietHours, SendResult } from "./notifications";

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
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.FCM_SERVER_KEY) {
        logger.debug("fcm: no server key, skipping", { id: row.id });
        return { status: "SENT", provider: "fcm-skip" };
      }
      try {
        const res = await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: { Authorization: `key=${env.FCM_SERVER_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            to: row.recipientAddress,
            notification: { title: row.title, body: row.body },
            data: { ...row.payload, locale: row.locale },
          }),
        });
        const json = (await res.json()) as { message_id?: string };
        return res.ok
          ? { status: "SENT", provider: "FCM", providerMessageId: json.message_id, deliveredAt: new Date() }
          : { status: "FAILED", failureReason: `FCM ${res.status}` };
      } catch (e) {
        return { status: "FAILED", failureReason: (e as Error).message };
      }
    },
  };
}

export function smsTransport(env: Env): NotificationTransport {
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.AFRICAS_TALKING_USERNAME || !env.AFRICAS_TALKING_API_KEY) {
        logger.debug("sms: no credentials, skipping", { id: row.id });
        return { status: "SENT", provider: "sms-skip" };
      }
      try {
        const res = await fetch("https://api.africastalking.com/version1/messaging", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            apiKey: env.AFRICAS_TALKING_API_KEY,
          },
          body: new URLSearchParams({
            username: env.AFRICAS_TALKING_USERNAME,
            to: row.recipientAddress ?? "",
            message: row.body,
            from: env.NOTIFICATION_FROM,
          }).toString(),
        });
        const json = (await res.json()) as { SMSMessageData?: { Recipients?: { messageId?: string }[] } };
        return res.ok
          ? { status: "SENT", provider: "AFRICAS_TALKING", providerMessageId: json.SMSMessageData?.Recipients?.[0]?.messageId }
          : { status: "FAILED", failureReason: `SMS ${res.status}` };
      } catch (e) {
        return { status: "FAILED", failureReason: (e as Error).message };
      }
    },
  };
}

export function emailTransport(env: Env): NotificationTransport {
  return {
    async send(row: NotificationRow): Promise<SendResult> {
      if (!env.EMAIL_API_URL) {
        logger.debug("email: no provider configured, skipping", { id: row.id, to: row.recipientAddress });
        return { status: "SENT", provider: "email-skip" };
      }
      try {
        const res = await fetch(env.EMAIL_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", [env.EMAIL_AUTH_HEADER]: String(env.EMAIL_API_KEY ?? "") },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: row.recipientAddress,
            subject: row.title,
            text: row.body,
            locale: row.locale,
          }),
        });
        return res.ok
          ? { status: "SENT", provider: "EMAIL" }
          : { status: "FAILED", failureReason: `EMAIL ${res.status}` };
      } catch (e) {
        return { status: "FAILED", failureReason: (e as Error).message };
      }
    },
  };
}
