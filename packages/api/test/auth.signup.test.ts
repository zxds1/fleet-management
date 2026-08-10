// packages/api/test/auth.signup.test.ts
// Self-service company signup (`POST /auth/signup`, 14_tenancy.sql). Signup now creates a COMPANY
// (app.tenants) plus its first member, who is granted a tenant-scoped ADMIN role — it is no longer
// a bare `AuthService.signupAdmin`. Split accordingly:
//   * request validation (email format, password strength) lives in `SignupSchema`;
//   * uniqueness, slug allocation, argon2id hashing and the ADMIN grant live in `TenancyService`.
// Both halves are asserted here with fakes — no DB.

import { ConflictError, SignupSchema } from "@fleet/shared";
import { TenancyService, slugifyCompanyName } from "../src/services/tenancy";
import type { UserRepository } from "../src/repositories/identity";
import type {
  InvitationRepository,
  ManagerAssignmentRepository,
  TenantRepository,
  TenantUserRepository,
  UserRoleRepository,
  UserTenantRepository,
} from "../src/repositories/tenancy";
import type { EmailService } from "../src/services/email";
import type { TenantRow, UserRow } from "@fleet/shared";

interface Recorder {
  createdUser: { email: string; passwordHash: string; fullName: string } | null;
  createdTenant: { name: string; slug: string; status: string; tier: string } | null;
  links: Array<{ userId: string; tenantId: string; isPrimary: boolean }>;
  grants: Array<{ userId: string; roleCode: string; grantedBy: string }>;
}

function makeService(opts: { existingEmail?: string; takenSlugs?: string[] } = {}): {
  svc: TenancyService;
  rec: Recorder;
} {
  const rec: Recorder = { createdUser: null, createdTenant: null, links: [], grants: [] };
  const taken = new Set(opts.takenSlugs ?? []);

  const users = {
    findByEmail: async (email: string) =>
      opts.existingEmail && opts.existingEmail === email ? ({ id: "u-existing", email } as UserRow) : null,
    insert: async (row: { email: string; password_hash: string; full_name: string }) => {
      rec.createdUser = { email: row.email, passwordHash: row.password_hash, fullName: row.full_name };
      return { id: "u-new", email: row.email, full_name: row.full_name } as UserRow;
    },
  } as unknown as UserRepository;

  const tenants = {
    findBySlug: async (slug: string) => (taken.has(slug) ? ({ id: "t-other", slug } as TenantRow) : null),
    create: async (i: { name: string; slug: string; status: string; subscriptionTier: string }) => {
      rec.createdTenant = { name: i.name, slug: i.slug, status: i.status, tier: i.subscriptionTier };
      return { id: "t-new", name: i.name, slug: i.slug } as TenantRow;
    },
  } as unknown as TenantRepository;

  const userTenants = {
    link: async (userId: string, tenantId: string, isPrimary: boolean) => {
      rec.links.push({ userId, tenantId, isPrimary });
    },
  } as unknown as UserTenantRepository;

  const userRoles = {
    grant: async (userId: string, roleCode: string, grantedBy: string) => {
      rec.grants.push({ userId, roleCode, grantedBy });
    },
  } as unknown as UserRoleRepository;

  const svc = new TenancyService(
    tenants,
    {} as InvitationRepository,
    userTenants,
    userRoles,
    {} as ManagerAssignmentRepository,
    {} as TenantUserRepository,
    users,
    {} as EmailService,
    "https://console.test",
  );
  return { svc, rec };
}

describe("SignupSchema (request validation)", () => {
  it("accepts a well-formed signup body", () => {
    const parsed = SignupSchema.safeParse({
      company_name: "Fleet Co",
      email: "asha@fleet.co.ke",
      password: "Trucking!2026Safe",
      full_name: "Asha Maina",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const parsed = SignupSchema.safeParse({
      company_name: "Fleet Co",
      email: "not-an-email",
      password: "Trucking!2026Safe",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path[0] === "email")).toBe(true);
  });

  it("rejects a short password below the 12-character floor", () => {
    const parsed = SignupSchema.safeParse({
      company_name: "Fleet Co",
      email: "new@fleet.co.ke",
      password: "password",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path[0] === "password")).toBe(true);
  });

  it("rejects a missing company name — signup always creates a tenant", () => {
    const parsed = SignupSchema.safeParse({ email: "new@fleet.co.ke", password: "Trucking!2026Safe" });
    expect(parsed.success).toBe(false);
  });
});

describe("TenancyService.signup", () => {
  it("creates the company and its first ADMIN on valid input", async () => {
    const { svc, rec } = makeService();

    const res = await svc.signup({
      companyName: "Fleet Co",
      email: "Asha@Fleet.co.ke",
      password: "Trucking!2026Safe",
      fullName: "Asha Maina",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.roleCode).toBe("ADMIN");
    expect(res.value.tenantId).toBe("t-new");
    expect(res.value.userId).toBe("u-new");

    // The address is normalised to lower case before it is stored.
    expect(rec.createdUser!.email).toBe("asha@fleet.co.ke");
    // argon2id, never a plaintext or a reversible digest.
    expect(rec.createdUser!.passwordHash.startsWith("$argon2")).toBe(true);
    // A TRIAL/BASIC company on the slugified name.
    expect(rec.createdTenant).toEqual({ name: "Fleet Co", slug: "fleet-co", status: "TRIAL", tier: "BASIC" });
    // The founder becomes a primary member and a tenant-scoped ADMIN (never SYSTEM_ADMIN).
    expect(rec.links).toEqual([{ userId: "u-new", tenantId: "t-new", isPrimary: true }]);
    expect(rec.grants).toEqual([{ userId: "u-new", roleCode: "ADMIN", grantedBy: "u-new" }]);
  });

  it("rejects a duplicate email rather than creating a second company around it", async () => {
    const { svc, rec } = makeService({ existingEmail: "taken@fleet.co.ke" });

    const res = await svc.signup({
      companyName: "Fleet Co",
      email: "taken@fleet.co.ke",
      password: "Trucking!2026Safe",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ConflictError);
    expect(res.error.error_code).toBe("USER_ALREADY_EXISTS");
    expect(rec.createdTenant).toBeNull();
  });

  it("allocates a free slug when the obvious one is taken", async () => {
    const { svc, rec } = makeService({ takenSlugs: ["fleet-co", "fleet-co-2"] });

    const res = await svc.signup({
      companyName: "Fleet Co",
      email: "new@fleet.co.ke",
      password: "Trucking!2026Safe",
    });

    expect(res.ok).toBe(true);
    expect(rec.createdTenant!.slug).toBe("fleet-co-3");
  });

  it("defaults the display name to the local part of the email", async () => {
    const { svc, rec } = makeService();

    await svc.signup({ companyName: "Fleet Co", email: "asha@fleet.co.ke", password: "Trucking!2026Safe" });

    expect(rec.createdUser!.fullName).toBe("asha");
  });
});

describe("slugifyCompanyName", () => {
  it("lower-cases, collapses separators and trims dashes", () => {
    expect(slugifyCompanyName("  Fleet & Co, Ltd.  ")).toBe("fleet-co-ltd");
  });

  it("pads a name that degenerates to fewer than two characters", () => {
    expect(slugifyCompanyName("株式会社").length).toBeGreaterThanOrEqual(2);
  });
});
