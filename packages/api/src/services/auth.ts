// packages/api/src/services/auth.ts
// Login / refresh / logout (02-auth.md §2). Password verification with argon2id; MFA gate for
// users whose role requires it (roles.requires_mfa) or who have opted in (users.mfa_enabled);
// account lockout after LOGIN_MAX_FAILURES (env, 02 §9 / M4). All mutations run inside the caller's
// transaction via http/write.ts so the failed-login counter and lockout commit atomically with the
// idempotency completion (D8).

import { AccountSuspended, conflict, err, ok, type Result, Unauthenticated } from "@fleet/shared";
import type { Env } from "../config/env";
import type { TokenService } from "../security/tokens";
import { argon2idHasher } from "../security/passwords";
import {
  PermissionRepository,
  UserRepository,
  type ResolvedPermissions,
} from "../repositories/identity";
import type { SessionService, IssuedSession } from "./session";

export type LoginResult =
  | { mfaRequired: false; session: IssuedSession; identity: ResolvedIdentityView }
  | { mfaRequired: true; challengeToken: string };

export interface LoginInput {
  /** Admins sign in with email, drivers with phone. Exactly one is supplied (LoginSchema). */
  email?: string | undefined;
  phone?: string | undefined;
  password: string;
  /** TOTP code for the second leg, when the account has MFA enrolled. */
  mfaCode?: string | undefined;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceIdHash?: string;
}

export interface AdminSignupInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Resolved identity returned alongside the session so the route can mirror the /login body. */
export type ResolvedIdentityView = {
  email: string;
  roles: ResolvedPermissions["roles"];
  permissions: ResolvedPermissions["permissions"];
  locale: "en" | "sw";
};

export interface AdminSignupResult {
  session: IssuedSession;
  identity: ResolvedIdentityView;
}

/** The slice of MfaService `login` needs, kept structural so AuthService stays unit-testable. */
export interface SecondFactorChecker {
  assertSecondFactor(userId: string, code: string): Promise<boolean>;
}

const emailTaken = () =>
  conflict("EMAIL_TAKEN", "Email already registered", "An account with this email already exists");

/** Postgres unique-violation (23505) — the `users_email_unique` partial index lost the race. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505";
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly permissions: PermissionRepository,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly env: Env,
    /** Validates the second factor when the account has MFA enrolled (single-call second leg). */
    private readonly mfa: SecondFactorChecker,
  ) {}

  async login(input: LoginInput): Promise<Result<LoginResult>> {
    // Drivers sign in by phone, admins by email (02 §2). LoginSchema guarantees exactly one.
    const user = input.email
      ? await this.users.findByEmail(input.email)
      : input.phone
        ? await this.users.findByPhone(input.phone)
        : null;
    if (!user) return err(new Unauthenticated("Invalid credentials"));

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
      return err(new Unauthenticated("Invalid credentials"));
    }

    if (user.mfa_enabled) {
      // Single-call second leg: the client re-posts /auth/login with `mfa_code` (a TOTP code, a
      // recovery code, or the bypass token from /auth/mfa/recover). Without one we issue the
      // challenge and the client shows the MFA screen.
      if (!input.mfaCode) {
        const challengeToken = this.tokens.issueMfaChallenge({ userId: user.id, email: user.email ?? "" });
        return ok({ mfaRequired: true, challengeToken });
      }
      const accepted = await this.mfa.assertSecondFactor(user.id, input.mfaCode);
      if (!accepted) return err(new Unauthenticated("Invalid MFA code"));
    }

    await this.users.recordSuccessfulLogin(user.id);

    const issued = await this.sessions.issue({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      deviceIdHash: input.deviceIdHash,
    });
    if (!issued.ok) return err(issued.error);

    const identity = await this.resolve(user.id);
    return ok({ mfaRequired: false, session: issued.value, identity });
  }

  async refresh(refreshToken: string): Promise<Result<IssuedSession>> {
    return this.sessions.refresh(refreshToken);
  }

  /**
   * Self-service ADMIN creation (A3.7). Hashes the password with argon2id, inserts the user plus
   * its ADMIN role grant, then issues a session exactly like a successful `/login` so the caller is
   * signed in immediately. Runs inside the request transaction (D8), so a failure to grant the role
   * rolls the user row back too.
   *
   * Email uniqueness is enforced here (pre-check, for a clean 409) and by the partial unique index
   * `users_email_unique`; the race between the two surfaces as a 23505, mapped to the same conflict.
   */
  async adminSignup(input: AdminSignupInput): Promise<Result<AdminSignupResult>> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.users.findByEmail(email);
    if (existing) return err(emailTaken());

    const passwordHash = await argon2idHasher.hash(input.password);

    let user;
    try {
      user = await this.users.createWithRoles({
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        phone: input.phone ?? null,
        roles: ["ADMIN"],
      });
    } catch (e) {
      if (isUniqueViolation(e)) return err(emailTaken());
      throw e;
    }

    const issued = await this.sessions.issue({
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    if (!issued.ok) return err(issued.error);

    const identity = await this.resolve(user.id);
    return ok({ session: issued.value, identity });
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(userId, sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.revokeAll(userId);
  }

  /** Resolves the precomputed permission union + roles + locale for a user id (N4 / C6.2). */
  async resolve(userId: string): Promise<{ email: string; roles: ResolvedPermissions["roles"]; permissions: ResolvedPermissions["permissions"]; locale: "en" | "sw" }> {
    const user = await this.users.getById(userId);
    if (!user) throw new Unauthenticated();
    const resolved = await this.permissions.resolve(userId);
    return { email: user.email ?? "", roles: resolved.roles, permissions: resolved.permissions, locale: (user.locale as "en" | "sw") ?? "en" };
  }
}
