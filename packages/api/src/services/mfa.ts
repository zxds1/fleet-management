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

export interface RecoverResult {
  userId: string;
  /** Short-lived `mfa_bypass`-scoped JWT; not an access token. */
  bypassToken: string;
  expiresAt: Date;
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
    return ok({ secret, otpauthUri: totp.provisioningUri(user.email ?? userId, secret) });
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

  /**
   * Validates a second factor supplied on the single-call `/auth/login` second leg. Accepts, in
   * order: a TOTP code, an unused recovery code, or a `mfa_bypass` token minted by `recover()`
   * for this same user. Returns false rather than throwing so the caller emits one generic
   * `Invalid MFA code` and the endpoint cannot be used to probe which factor was wrong.
   */
  async assertSecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await this.users.getById(userId);
    if (!user || !user.mfa_enabled || !user.mfa_secret_encrypted) return false;

    const secret = this.secretBox.decrypt(user.mfa_secret_encrypted);
    if (totp.verify(secret, code)) return true;
    if (await this.recovery.consume(userId, sha256Hex(code.trim().toUpperCase()))) return true;
    try {
      return this.tokens.verifyMfaBypass(code).userId === userId;
    } catch {
      return false;
    }
  }

  /**
   * Recovery-code bypass (A3.7): burns one stored recovery code and returns a short-lived
   * `mfa_bypass` token instead of a full session, so the caller must still complete the normal
   * sign-in leg. Codes live in app.mfa_recovery_codes as SHA-256 hashes (see generateRecoveryCodes)
   * and `consume` is a single conditional UPDATE, so a code stays single-use under concurrency.
   *
   * Unknown-user and bad-code paths return the identical error so the endpoint cannot be used to
   * enumerate accounts.
   */
  async recover(
    identifier: { email?: string; userId?: string },
    recoveryCode: string,
  ): Promise<Result<RecoverResult>> {
    const invalid = () => err(new ValidationError("Invalid recovery code"));

    const user = identifier.userId
      ? await this.users.getById(identifier.userId)
      : identifier.email
        ? await this.users.findByEmail(identifier.email)
        : null;

    if (!user || !user.is_active) return invalid();
    if (!user.mfa_enabled) return err(new ValidationError("MFA is not enabled for this account"));

    const normalised = recoveryCode.trim().toUpperCase();
    if (!(await this.recovery.consume(user.id, sha256Hex(normalised)))) return invalid();

    const bypass = this.tokens.issueMfaBypass({ userId: user.id, email: user.email ?? "" });
    return ok({ userId: user.id, bypassToken: bypass.token, expiresAt: bypass.expiresAt });
  }
}
