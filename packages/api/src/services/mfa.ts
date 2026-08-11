// packages/api/src/services/mfa.ts
// Role-routed DELIVERED OTP MFA (replaces TOTP). On enrolment we generate 10 recovery codes (stored
// only as salted hashes); the login OTP itself is a 6-digit code delivered out-of-band — drivers by
// SMS (Africa's Talking), admins by email (Resend). The code is held in Redis (sha256 compared
// constant-time on verify) with a 5-minute TTL and an attempt cap of 5. Recovery codes remain a
// supported fallback.

import { randomInt, timingSafeEqual } from "node:crypto";
import { type Result, err, ok, Unauthenticated, ValidationError } from "@fleet/shared";
import type { MfaDeliveryChannel } from "@fleet/shared";
import { generateRecoveryCodes, sha256Hex } from "../security/crypto";
import type { TokenService } from "../security/tokens";
import type { OtpStore } from "../security/otpStore";
import type { UserRepository, MfaRecoveryCodeRepository, PermissionRepository } from "../repositories/identity";
import type { SessionService, IssuedSession } from "./session";
import type { MfaDeliveryService } from "./mfaDelivery";

export interface EnrollResult {
  recoveryCodes: string[];
}

export interface VerifyResult {
  session: IssuedSession;
}

/** Maximum OTP attempts within the 5-minute window before the code is invalidated. */
const MAX_OTP_ATTEMPTS = 5;

export class MfaService {
  constructor(
    private readonly users: UserRepository,
    private readonly recovery: MfaRecoveryCodeRepository,
    private readonly permissions: PermissionRepository,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly otp: OtpStore,
    private readonly delivery: MfaDeliveryService,
  ) {}

  /** One-step enrolment: generate + store recovery codes and activate MFA. Returns the plaintext
   *  recovery codes once (they are never returned again). No TOTP secret is created. */
  async enroll(userId: string): Promise<Result<EnrollResult>> {
    const user = await this.users.getById(userId);
    if (!user) return err(new Unauthenticated());
    const { plain, hashed } = generateRecoveryCodes(10);
    await this.recovery.replaceAll(userId, hashed);
    await this.users.activateMfa(userId);
    return ok({ recoveryCodes: plain });
  }

  /** Resolves the OTP delivery channel from the user's roles + available contact, then sends the
   *  code. Reuses an already-live code (no regeneration) so an attacker cannot reset the attempt
   *  counter by forcing resends. Throws/errs when no deliverable contact exists (login is blocked). */
  async sendCode(userId: string): Promise<Result<void>> {
    const user = await this.users.getById(userId);
    if (!user) return err(new Unauthenticated());

    const resolved = await this.permissions.resolve(userId);
    const isDriver = resolved.roles.includes("DRIVER");

    let to: string;
    let channel: MfaDeliveryChannel;
    if (isDriver && user.phone) {
      to = user.phone;
      channel = "sms";
    } else if (user.email) {
      to = user.email;
      channel = "email";
    } else {
      return err(new ValidationError("No verified contact (phone/email) on file to deliver MFA code"));
    }

    // Reuse the live code if one exists; otherwise mint a fresh 6-digit code.
    let code = await this.otp.get(userId);
    if (!code) {
      code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      await this.otp.set(userId, code);
    }

    try {
      if (channel === "sms") await this.delivery.sendSms(to, code);
      else await this.delivery.sendEmail(to, code);
    } catch (e) {
      return err(new ValidationError(`Could not deliver MFA code: ${(e as Error).message}`));
    }
    return ok(undefined);
  }

  /** Verifies the MFA challenge + code and issues a session. Recovery codes are tried first (and
   *  consumed); otherwise the delivered OTP is verified constant-time with the attempt cap enforced. */
  async verify(challengeToken: string, code: string): Promise<Result<VerifyResult>> {
    const { userId } = this.tokens.verifyMfaChallenge(challengeToken);
    const user = await this.users.getById(userId);
    if (!user || !user.mfa_enabled) {
      return err(new Unauthenticated("MFA not configured for this account"));
    }

    // Recovery code path (consumed on success).
    if (await this.recovery.consume(userId, sha256Hex(code.toUpperCase()))) {
      await this.otp.delete(userId);
      const session = await this.sessions.issue({ userId });
      if (session.ok) return ok({ session: session.value });
      return err(session.error);
    }

    const stored = await this.otp.get(userId);
    if (!stored) {
      return err(new ValidationError("No active login code; request a new one"));
    }

    // Constant-time compare of the SHA-256 hashes (equal length required for timingSafeEqual).
    const inputHash = sha256Hex(code);
    const storedHash = sha256Hex(stored);
    const matches =
      inputHash.length === storedHash.length &&
      timingSafeEqual(Buffer.from(inputHash, "utf8"), Buffer.from(storedHash, "utf8"));

    if (matches) {
      await this.otp.delete(userId);
      const session = await this.sessions.issue({ userId });
      if (session.ok) return ok({ session: session.value });
      return err(session.error);
    }

    const attempts = await this.otp.incrementAttempts(userId);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      // Brute-force guard: invalidate the code once the cap is exceeded.
      await this.otp.delete(userId);
      return err(new ValidationError("Too many attempts; request a new login code"));
    }
    return err(new ValidationError("Invalid MFA code or recovery code"));
  }
}
