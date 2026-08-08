// packages/api/src/services/auth.ts
// Login / refresh / logout (02-auth.md §2). Password verification with argon2id; MFA is OPTIONAL
// and opt-in only (challenged solely when users.mfa_enabled). Drivers authenticate by phone, admins
// by email. Account lockout after LOGIN_MAX_FAILURES (env, 02 §9 / M4). All mutations run inside the
// caller's transaction via http/write.ts so the failed-login counter and lockout commit atomically
// with the idempotency completion (D8).

import { AccountSuspended, err, ok, type Result, Unauthenticated, ValidationError } from "@fleet/shared";
import type { Env } from "../config/env";
import type { TokenService } from "../security/tokens";
import { argon2idHasher } from "../security/passwords";
import { checkPasswordStrength } from "../security/passwordPolicy";
import {
  PermissionRepository,
  UserRepository,
  type ResolvedPermissions,
} from "../repositories/identity";
import type { SessionService, IssuedSession } from "./session";

export type LoginResult =
  | { mfaRequired: false; session: IssuedSession }
  | { mfaRequired: true; challengeToken: string };

export interface LoginInput {
  email?: string;
  phone?: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceIdHash?: string;
}

export interface SignupAdminInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
}

export interface SignupAdminResult {
  userId: string;
  email: string;
  role: "ADMIN";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly permissions: PermissionRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly env: Env,
  ) {}

  async login(input: LoginInput): Promise<Result<LoginResult>> {
    const user = input.phone
      ? await this.users.findByPhone(input.phone)
      : await this.users.findByEmail(input.email ?? "");
    if (!user) return err(new Unauthenticated("Invalid email or password"));

    if (!user.is_active) return err(new AccountSuspended());
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return err(new Unauthenticated("Account temporarily locked. Try again later."));
    }

    const valid = await argon2idHasher.verify(user.password_hash, input.password);
    if (!valid) {
      const count = await this.users.recordFailedLogin(user.id, null);
      if (count >= this.env.LOGIN_MAX_FAILURES) {
        const until = new Date(Date.now() + this.env.LOGIN_LOCKOUT_MINUTES * 60_000);
        await this.users.setLockout(user.id, until);
      }
      return err(new Unauthenticated("Invalid email or password"));
    }

    await this.users.recordSuccessfulLogin(user.id);

    // MFA is OPTIONAL and opt-in: only challenged when the user has enrolled (users.mfa_enabled).
    if (user.mfa_enabled) {
      const challengeToken = this.tokens.issueMfaChallenge({ userId: user.id, email: user.email ?? "" });
      return ok({ mfaRequired: true, challengeToken });
    }

    const issued = await this.sessions.issue({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceIdHash: input.deviceIdHash,
    });
    if (issued.ok) return ok({ mfaRequired: false, session: issued.value });
    return err(issued.error);
  }

  async refresh(refreshToken: string): Promise<Result<IssuedSession>> {
    return this.sessions.refresh(refreshToken);
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(userId, sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.revokeAll(userId);
  }

  /**
   * Self-service admin account creation (A3.7 signup). Validates email format + uniqueness, enforces
   * the password-strength policy, hashes with argon2id, creates an ACTIVE user granted the ADMIN role.
   * MFA is optional, so the new admin may enrol later via /auth/mfa/enroll. No direct DB seeding
   * required.
   */
  async signupAdmin(input: SignupAdminInput): Promise<Result<SignupAdminResult>> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return err(new ValidationError("Invalid email address", [
        { field: "email", code: "INVALID_EMAIL", message: "Enter a valid email address." },
      ]));
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      return err(new ValidationError("Email already registered", [
        { field: "email", code: "EMAIL_TAKEN", message: "An account with this email already exists." },
      ]));
    }

    const strength = checkPasswordStrength(input.password, email);
    if (!strength.ok) {
      return err(
        new ValidationError("Password too weak: " + strength.reasons.join(" "), strength.reasons.map((message) => ({
          field: "password",
          code: "WEAK_PASSWORD",
          message,
        }))),
      );
    }

    const hash = await argon2idHasher.hash(input.password);
    const fullName = (input.fullName.trim() || email.split("@")[0]) ?? email;
    const user = await this.users.create({
      email,
      passwordHash: hash,
      fullName,
      phone: input.phone ?? null,
      isActive: true,
      mfaEnabled: false,
    });
    await this.users.assignRole(user.id, "ADMIN");

    return ok({ userId: user.id, email: user.email ?? email, role: "ADMIN" });
  }

  /** Resolves the precomputed permission union + roles + locale for a user id (N4 / C6.2). */
  async resolve(userId: string): Promise<{ email: string; phone?: string; roles: ResolvedPermissions["roles"]; permissions: ResolvedPermissions["permissions"]; locale: "en" | "sw" }> {
    const user = await this.users.getById(userId);
    if (!user) throw new Unauthenticated();
    const resolved = await this.permissions.resolve(userId);
    return { email: user.email ?? "", phone: user.phone ?? undefined, roles: resolved.roles, permissions: resolved.permissions, locale: (user.locale as "en" | "sw") ?? "en" };
  }
}
