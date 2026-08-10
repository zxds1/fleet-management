// packages/api/src/services/email.ts
// Invitation delivery (14_tenancy.sql). The accept token is a single-use capability that must only
// ever travel to the invitee over email — it is NEVER returned in an API response. In production
// this is backed by SES/SMTP; the default ConsoleEmailService logs the message so local dev and
// tests exercise the full flow without an external mailer.

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
