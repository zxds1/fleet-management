// packages/api/src/services/mfa.ts
// TOTP enrolment + verification + recovery codes (02-auth.md §3). The TOTP seed is encrypted at rest
// with AES-GCM (SecretBox) in users.mfa_secret_encrypted and never returned in clear. Recovery codes
// are generated server-side, shown once, and stored only as salted hashes.

import type { Result } from "@fleet/shared";
import { err, ok, Unauthenticated, ValidationError } from "@fleet/shared";
import { SecretBox, generateRecoveryCodes, sha256Hex } from "../security/crypto";
import { totp } from "../security/totp";
import type { TokenService } from "../security/tokens";
import type { UserRepository, MfaRecoveryCodeRepository } from "../repositories/identity";
import type { SessionService, IssuedSession } from "./session";

export interface EnrollResult {
  secret: string;
  otpauthUri: string;
}

export interface ConfirmResult {
  recoveryCodes: string[];
}

export class MfaService {
  constructor(
    private readonly users: UserRepository,
    private readonly recovery: MfaRecoveryCodeRepository,
    private readonly secretBox: SecretBox,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async enroll(userId: string): Promise<Result<EnrollResult>> {
    const user = await this.users.getById(userId);
    if (!user) return err(new Unauthenticated());
    const secret = totp.generateSecret();
    await this.users.stageMfaSecret(userId, this.secretBox.encrypt(secret));
    return ok({ secret, otpauthUri: totp.provisioningUri(user.email ?? "", secret) });
  }

  async confirm(userId: string, code: string): Promise<Result<ConfirmResult>> {
    const user = await this.users.getById(userId);
    if (!user || !user.mfa_secret_encrypted) return err(new ValidationError("MFA enrolment not started"));
    const secret = this.secretBox.decrypt(user.mfa_secret_encrypted);
    if (!totp.verify(secret, code)) return err(new ValidationError("Invalid verification code"));

    const { plain, hashed } = generateRecoveryCodes(10);
    await this.recovery.replaceAll(userId, hashed);
    await this.users.activateMfa(userId);
    return ok({ recoveryCodes: plain });
  }

  /** Consumes the MFA challenge issued at password step and returns signed tokens on success. */
  async verify(challengeToken: string, code: string): Promise<Result<{ session: IssuedSession }>> {
    const { userId } = this.tokens.verifyMfaChallenge(challengeToken);
    const user = await this.users.getById(userId);
    if (!user || !user.mfa_enabled || !user.mfa_secret_encrypted) {
      return err(new Unauthenticated("MFA not configured for this account"));
    }
    const secret = this.secretBox.decrypt(user.mfa_secret_encrypted);
    if (totp.verify(secret, code)) {
      const session = await this.sessions.issue({ userId });
      if (session.ok) return ok({ session: session.value });
      return err(session.error);
    }
    if (await this.recovery.consume(userId, sha256Hex(code.toUpperCase()))) {
      const session = await this.sessions.issue({ userId });
      if (session.ok) return ok({ session: session.value });
      return err(session.error);
    }
    return err(new ValidationError("Invalid MFA code or recovery code"));
  }
}
