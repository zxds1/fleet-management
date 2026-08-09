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
  };
}

function buildAuth(overrides: {
  user?: UserRow | null;
  failedLoginCount?: number;
  lockoutAfter?: number;
  /** Verdict the injected second-factor checker returns for the single-call MFA leg. */
  secondFactorOk?: boolean;
}): {
  service: AuthService;
  calls: {
    failedLogins: number[];
    lockouts: { userId: string; until: Date | null }[];
    issued: number;
    secondFactor: string[];
  };
} {
  const calls = {
    failedLogins: [] as number[],
    lockouts: [] as { userId: string; until: Date | null }[],
    issued: 0,
    secondFactor: [] as string[],
  };
  const passwordHash = overrides.user?.password_hash ?? "hash";
  const users = {
    findByEmail: async (email: string) => (overrides.user && overrides.user.email === email ? overrides.user : null),
    findByPhone: async (phone: string) => {
      const want = phone.replace(/\D/g, "");
      const have = (overrides.user?.phone ?? "").replace(/\D/g, "");
      return overrides.user && want && want === have ? overrides.user : null;
    },
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

  const mfa = {
    assertSecondFactor: async (_userId: string, code: string) => {
      calls.secondFactor.push(code);
      return overrides.secondFactorOk ?? false;
    },
  };

  const tokens = new TokenService(env()) as unknown as TokenService;
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

describe("AuthService.login — driver phone sign-in (02 §2)", () => {
  const driver = async () =>
    ({
      id: "user-1",
      email: null,
      phone: "+254700000000",
      password_hash: await argon2idHasher.hash("s3cret"),
      is_active: true,
      mfa_enabled: false,
      locked_until: null,
    }) as unknown as UserRow;

  it("authenticates a driver by phone number", async () => {
    const { service, calls } = buildAuth({ user: await driver() });
    const result = await service.login({ phone: "+254700000000", password: "s3cret" });
    expect(result.ok).toBe(true);
    expect(calls.issued).toBe(1);
  });

  it("matches a phone number regardless of separators / leading +", async () => {
    const { service } = buildAuth({ user: await driver() });
    const result = await service.login({ phone: "254 700 000 000", password: "s3cret" });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown phone number with a generic error", async () => {
    const { service } = buildAuth({ user: await driver() });
    const result = await service.login({ phone: "+254711111111", password: "s3cret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Unauthenticated);
  });
});

describe("AuthService.login — resolved identity + MFA second leg", () => {
  const mfaUser = async (mfaEnabled: boolean) =>
    ({
      id: "user-1",
      email: "a@b.co",
      password_hash: await argon2idHasher.hash("s3cret"),
      is_active: true,
      mfa_enabled: mfaEnabled,
      locked_until: null,
    }) as UserRow;

  it("returns the resolved identity alongside the session so the client can build a Principal", async () => {
    const { service } = buildAuth({ user: await mfaUser(false) });
    const result = await service.login({ email: "a@b.co", password: "s3cret" });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.mfaRequired) {
      expect(result.value.identity).toEqual({ email: "a@b.co", roles: [], permissions: [], locale: "en" });
    }
  });

  it("completes the second leg in one call when a valid mfa_code is supplied", async () => {
    const { service, calls } = buildAuth({ user: await mfaUser(true), secondFactorOk: true });
    const result = await service.login({ email: "a@b.co", password: "s3cret", mfaCode: "123456" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mfaRequired).toBe(false);
    expect(calls.secondFactor).toEqual(["123456"]);
    expect(calls.issued).toBe(1);
  });

  it("rejects an invalid mfa_code without issuing a session", async () => {
    const { service, calls } = buildAuth({ user: await mfaUser(true), secondFactorOk: false });
    const result = await service.login({ email: "a@b.co", password: "s3cret", mfaCode: "000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Unauthenticated);
    expect(calls.issued).toBe(0);
  });

  it("does not consume a second factor when none is supplied (challenge branch)", async () => {
    const { service, calls } = buildAuth({ user: await mfaUser(true) });
    const result = await service.login({ email: "a@b.co", password: "s3cret" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mfaRequired).toBe(true);
    expect(calls.secondFactor).toHaveLength(0);
    expect(calls.issued).toBe(0);
  });
});
