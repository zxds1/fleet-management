// packages/api/src/services/consent.ts
// GDPR-style consent ledger (02-auth.md §7 / M3). Each acceptance is append-only
// (app.user_consents); revocation inserts a closed row. Re-accepting the same policy version is a
// no-op (ON CONFLICT). A driver cannot start a shift without a live GPS_TRACKING_WORKING_HOURS
// consent (03 §2.2) — requireFor enforces that.

import type { Result } from "@fleet/shared";
import { ConsentRequired, err, ok } from "@fleet/shared";
import type { ConsentType } from "@fleet/shared";
import type { ConsentRepository } from "../repositories/identity";

export interface AcceptConsentInput {
  userId: string;
  consentType: ConsentType;
  policyVersion: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceIdHash?: string | null;
}

export class ConsentService {
  constructor(private readonly consents: ConsentRepository) {}

  async accept(input: AcceptConsentInput): Promise<Result<{ consentId: string }>> {
    const row = await this.consents.accept(input);
    return ok({ consentId: row.id });
  }

  async revoke(userId: string, consentType: ConsentType): Promise<Result<{ revoked: number }>> {
    const revoked = await this.consents.revoke(userId, consentType);
    return ok({ revoked });
  }

  /** Throws ConsentRequired when no live acceptance exists — callers gate work on this. */
  async requireFor(userId: string, consentType: ConsentType): Promise<Result<{ ok: true }>> {
    const accepted = await this.consents.findAccepted(userId, consentType);
    if (!accepted) return err(new ConsentRequired());
    return ok({ ok: true });
  }

  async has(userId: string, consentType: ConsentType): Promise<boolean> {
    return (await this.consents.findAccepted(userId, consentType)) !== null;
  }

  /**
   * Status projection for `GET /me/consent` (contract status endpoint). `consented` is whether the
   * principal has any accepted record of the canonical data-processing notice; `current_version` is
   * that record's policy version (or null); `required_version` is the configured version the client
   * must meet. The canonical consent is `DATA_PROCESSING_NOTICE` — the baseline every user accepts.
   */
  async getStatus(
    userId: string,
    requiredVersion: string,
  ): Promise<{ consented: boolean; current_version: string | null; required_version: string }> {
    const accepted = await this.consents.findAccepted(userId, "DATA_PROCESSING_NOTICE" as ConsentType);
    return {
      consented: accepted !== null,
      current_version: accepted?.policy_version ?? null,
      required_version: requiredVersion,
    };
  }
}
