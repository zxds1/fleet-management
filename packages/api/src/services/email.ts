// packages/api/src/services/email.ts
// Invitation delivery (14_tenancy.sql). The accept token is a single-use capability that must only
// ever travel to the invitee over email — it is NEVER returned in an API response. In production
// this is backed by Resend; the default ConsoleEmailService logs the message so local dev and
// tests exercise the full flow without an external mailer.

import { logger } from "@fleet/shared";
import type { Env } from "../config/env";

export interface InvitationEmailInput {
  to: string;
  tenantName: string;
  roleCode: string;
  /** Absolute URL the recipient opens to accept (contains the single-use token). */
  acceptUrl: string;
  expiresAt: Date;
}

export interface EmailService {
  /** Delivers the admin invitation email. Failures are logged, not thrown — a mail outage must
   * not roll back the (already-committed) invitation row. */
  sendInvitation(input: InvitationEmailInput): Promise<void>;
}

/** Dev/test implementation: prints the invitation to stdout. Swap for a real transport in prod. */
export class ConsoleEmailService implements EmailService {
  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    const expires = input.expiresAt.toISOString();
    // eslint-disable-next-line no-console
    console.info(
      `[email] invitation → ${input.to}\n` +
        `  company: ${input.tenantName}\n` +
        `  role:    ${input.roleCode}\n` +
        `  accept:  ${input.acceptUrl}\n` +
        `  expires: ${expires}`,
    );
  }
}

/** Production transport: delivers via Resend. Failures are logged (never thrown) so an invitation
 *  row that has already committed is not rolled back by a downstream mail outage. */
export class ResendEmailService implements EmailService {
  constructor(private readonly env: Env) {}

  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    if (!this.env.RESEND_API_KEY) {
      logger.warn("resend: no RESEND_API_KEY configured, skipping invitation email", { to: input.to });
      return;
    }
    const expires = input.expiresAt.toISOString();
    const text =
      `You have been invited to ${input.tenantName} as ${input.roleCode}.\n` +
      `Accept your invitation: ${input.acceptUrl}\n` +
      `This invitation expires at ${expires}.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM,
          to: input.to,
          subject: `You're invited to ${input.tenantName}`,
          text,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.error("resend: invitation email failed", { to: input.to, status: res.status });
      }
    } catch (e) {
      // A mail outage must not roll back the invitation — log and move on.
      logger.error("resend: invitation email delivery error", { to: input.to, message: (e as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }
}
