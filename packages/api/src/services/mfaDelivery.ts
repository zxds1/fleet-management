// packages/api/src/services/mfaDelivery.ts
// Out-of-band OTP delivery for role-routed MFA. Drivers get an SMS via Africa's Talking; admins get
// an email via Resend. Both are plain `fetch` + AbortController (8s) calls — no SDK. Each throws when
// its credentials are absent so the caller (login) can surface a clear "could not send code" error.

import { logger } from "@fleet/shared";
import type { Env } from "../config/env";

export interface MfaDeliveryService {
  sendEmail(to: string, code: string): Promise<void>;
  sendSms(to: string, code: string): Promise<void>;
}

const TIMEOUT_MS = 8_000;

export class ResendMfaDeliveryService implements MfaDeliveryService {
  constructor(private readonly env: Env) {}

  async sendEmail(to: string, code: string): Promise<void> {
    if (!this.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured; cannot deliver MFA email");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM,
          to,
          subject: "Your login code",
          text: `Your Fleet verification code is ${code}. It expires in 5 minutes.`,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Resend email delivery failed with status ${res.status}`);
      }
    } catch (e) {
      logger.error("mfa email delivery failed", { to, message: (e as Error).message });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async sendSms(to: string, code: string): Promise<void> {
    if (!this.env.AFRICAS_TALKING_API_KEY || !this.env.AFRICAS_TALKING_USERNAME) {
      throw new Error("Africa's Talking credentials are not configured; cannot deliver MFA SMS");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          apiKey: this.env.AFRICAS_TALKING_API_KEY,
        },
        body: new URLSearchParams({
          username: this.env.AFRICAS_TALKING_USERNAME,
          to,
          message: `Your Fleet verification code is ${code}`,
          from: this.env.NOTIFICATION_FROM,
        }).toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Africa's Talking SMS delivery failed with status ${res.status}`);
      }
    } catch (e) {
      logger.error("mfa sms delivery failed", { to, message: (e as Error).message });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
