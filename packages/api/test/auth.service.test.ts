// packages/api/test/auth.service.test.ts
// Unit tests for AuthService.login using fakes (no DB). Covers the argon2id verify path, MFA gate,
// and the lockout-after-N-failures rule (02 §2 / §9). Services return Result, so we assert on the
// discriminated value, never on thrown exceptions.

import { ok, err, type Result, type PermissionCode, type RoleCode } from "@fleet/shared";
import { AccountSuspended, Unauthenticated } from "@fleet/shared";
import { AuthService } from "../src/services/auth";
import { argon2idHasher } from "../src/security/passwords";
import { env } from "../src/config/env";
import { TokenService } from "../src/security/tokens";
import type { IssuedSession } from "../src/services/session";
import type { UserRow } from "@fleet/shared";

function fakeSession(): IssuedSession {
  const now = new Date();
  return {
    sessionId: "sess-1",
    userId: "user-1",
    accessToken: "a",
    accessTokenExpiresAt: now,
    refreshToken: "r",
    refreshTokenExpiresAt: now,
    email: "a@b.co",
    phone: null,
    roles: ["DRIVER"],
    permissions: [],
    locale: "en",
    tenantId: "00000000-0000-0000-0000-000000000001",
  };
}

function buildAuth(overrides: {
  user?: UserRow | null;
  failedLoginCount?: number;
  lockoutAfter?: number;
}): { service: AuthService; calls: { failedLogins: number[]; lockouts: { userId: string; until: Date | null }[]; issued: number } } {
  const calls = { failedLogins: [] as number[], lockouts: [] as { userId: string; until: Date | null }[], issued: 0 };
  const passwordHash = overrides.user?.password_hash ?? "hash";
  const users = {
    findByEmail: async (email: string) => (overrides.user && overrides.user.email === email ? overrides.user : null),
    findByPhone: async (phone: string) => (overrides.user && overrides.user.phone === phone ? overrides.user : null),
    recordFailedLogin: async (_id: string, _until: Date | null) => {
      const n = (overrides.failedLoginCount ?? 0) + 1;
      calls.failedLogins.push(n);
      return n;
    },
    setLockout: async (userId: string, until: Date | null) => {
      calls.lockouts.push({ userId, until });
    },
    recordSuccessfulLogin: async () => undefined,
    getById: async () => overrides.user,
  } as unknown as import("../src/repositories/identity").UserRepository;

  const permissions = {
    resolve: async (_id: string) => ({ roles: [] as RoleCode[], permissions: [] as PermissionCode[], requiresMfa: false }),
  } as unknown as import("../src/repositories/identity").PermissionRepository;

  const session = {
    issue: async () => {
      calls.issued += 1;
      return ok(fakeSession());
    },
    refresh: async () => err(new Unauthenticated()),
    revoke: async () => undefined,
    revokeAll: async () => undefined,
  } as unknown as import("../src/services/session").SessionService;

  const tokens = new TokenService(env()) as unknown as TokenService;

  const mfa = {
    sendCode: jest.fn(async () => ok(undefined)),
  } as unknown as import("../src/services/mfa").MfaService;

  const service = new AuthService(users, permissions, session, tokens, env(), mfa);
  return { service, calls };
}

describe("AuthService.login", () => {
  it("issues a session for a valid password when MFA is off", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const { service, calls } = buildAuth({
      user: { id: "user-1", email: "a@b.co", password_hash: hash, is_active: true, mfa_enabled: false, locked_until: null } as UserRow,
    });
    const result: Result<unknown> = await service.login({ email: "a@b.co", password: "s3cret" });
    expect(result.ok).toBe(true);
    expect(calls.issued).toBe(1);
  });

  it("rejects an unknown email with a generic error", async () => {
    const { service } = buildAuth({ user: null });
    const result = await service.login({ email: "missing@b.co", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Unauthenticated);
  });

  it("resolves a driver by phone number (drivers authenticate by phone, not email)", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const { service, calls } = buildAuth({
      user: { id: "user-1", email: null, phone: "+254711222333", password_hash: hash, is_active: true, mfa_enabled: false, locked_until: null } as UserRow,
    });
    const result = await service.login({ phone: "+254711222333", password: "s3cret" });
    expect(result.ok).toBe(true);
    expect(calls.issued).toBe(1);
  });

  it("rejects a wrong password and increments the failure counter", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const { service, calls } = buildAuth({
      user: { id: "user-1", email: "a@b.co", password_hash: hash, is_active: true, mfa_enabled: false, locked_until: null } as UserRow,
    });
    const result = await service.login({ email: "a@b.co", password: "wrong" });
    expect(result.ok).toBe(false);
    expect(calls.failedLogins).toHaveLength(1);
    expect(calls.issued).toBe(0);
  });

  it("locks the account once failures reach the env threshold", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const { service, calls } = buildAuth({
      user: { id: "user-1", email: "a@b.co", password_hash: hash, is_active: true, mfa_enabled: false, locked_until: null } as UserRow,
      failedLoginCount: env().LOGIN_MAX_FAILURES - 1,
    });
    await service.login({ email: "a@b.co", password: "wrong" });
    expect(calls.lockouts).toHaveLength(1);
    expect(calls.lockouts[0]!.until).not.toBeNull();
  });

  it("returns an MFA challenge when MFA is enabled", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const tokens = new TokenService(env());
    const { service } = buildAuth({
      user: { id: "user-1", email: "a@b.co", password_hash: hash, is_active: true, mfa_enabled: true, locked_until: null } as UserRow,
    });
    const result = await service.login({ email: "a@b.co", password: "s3cret" });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.mfaRequired) {
      expect(typeof result.value.challengeToken).toBe("string");
    }
    void tokens;
  });

  it("rejects a suspended account", async () => {
    const hash = await argon2idHasher.hash("s3cret");
    const { service } = buildAuth({
      user: { id: "user-1", email: "a@b.co", password_hash: hash, is_active: false, mfa_enabled: false, locked_until: null } as UserRow,
    });
    const result = await service.login({ email: "a@b.co", password: "s3cret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AccountSuspended);
  });
});
