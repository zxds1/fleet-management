// packages/api/test/auth.signup.test.ts
// Self-service admin signup (A3.7): email format + uniqueness, password-strength policy, argon2id
// hashing, and ADMIN role assignment. Uses fakes — no DB.

import { ok, ValidationError, type AppError } from "@fleet/shared";
import { AuthService } from "../src/services/auth";
import type { UserRepository, PermissionRepository } from "../src/repositories/identity";
import type { SessionService } from "../src/services/session";
import type { TokenService } from "../src/security/tokens";
import type { Env } from "../src/config/env";
import type { UserRow } from "@fleet/shared";

function fakeEnv(): Env {
  return {
    LOGIN_MAX_FAILURES: 5,
    LOGIN_LOCKOUT_MINUTES: 15,
  } as unknown as Env;
}

function fieldCode(e: AppError, field: string): string | undefined {
  const fe = (e as ValidationError).field_errors;
  return fe?.find((f) => f.field === field)?.code;
}

describe("AuthService.signupAdmin", () => {
  it("creates an ADMIN account on valid input", async () => {
    let created: { email: string; hash: string; role?: string } | null = null;
    const users = {
      findByEmail: async () => null,
      create: async (i: { email: string; passwordHash: string; fullName: string }) => {
        created = { email: i.email, hash: i.passwordHash };
        return { id: "u-new", email: i.email, full_name: i.fullName } as UserRow;
      },
      assignRole: async (_id: string, role: string) => {
        created!.role = role;
      },
    } as unknown as UserRepository;
    const svc = new AuthService(users, {} as PermissionRepository, {} as SessionService, {} as TokenService, fakeEnv());

    const res = await svc.signupAdmin({
      email: "Asha@Fleet.co.ke",
      password: "Trucking!2026Safe",
      fullName: "Asha Maina",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.role).toBe("ADMIN");
    expect(res.value.email).toBe("asha@fleet.co.ke"); // normalised to lower-case
    expect(created!.role).toBe("ADMIN");
    expect(created!.hash.startsWith("$argon2")).toBe(true);
  });

  it("rejects a duplicate email", async () => {
    const users = {
      findByEmail: async () => ({ id: "existing" } as UserRow),
      create: async () => ({ id: "x" } as UserRow),
      assignRole: async () => undefined,
    } as unknown as UserRepository;
    const svc = new AuthService(users, {} as PermissionRepository, {} as SessionService, {} as TokenService, fakeEnv());
    const res = await svc.signupAdmin({ email: "taken@fleet.co.ke", password: "Trucking!2026Safe", fullName: "X" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
    expect(fieldCode(res.error, "email")).toBe("EMAIL_TAKEN");
  });

  it("rejects a weak password", async () => {
    const users = {
      findByEmail: async () => null,
      create: async () => ({ id: "x" } as UserRow),
      assignRole: async () => undefined,
    } as unknown as UserRepository;
    const svc = new AuthService(users, {} as PermissionRepository, {} as SessionService, {} as TokenService, fakeEnv());
    const res = await svc.signupAdmin({ email: "new@fleet.co.ke", password: "password", fullName: "X" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(fieldCode(res.error, "password")).toBe("WEAK_PASSWORD");
  });

  it("rejects an invalid email", async () => {
    const svc = new AuthService({} as UserRepository, {} as PermissionRepository, {} as SessionService, {} as TokenService, fakeEnv());
    const res = await svc.signupAdmin({ email: "not-an-email", password: "Trucking!2026Safe", fullName: "X" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(fieldCode(res.error, "email")).toBe("INVALID_EMAIL");
  });
});
