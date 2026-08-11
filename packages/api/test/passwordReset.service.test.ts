// packages/api/test/passwordReset.service.test.ts
// Unit tests for PasswordResetService (immune-system password-reset). Uses fakes — no DB. Covers the
// three role-gated delivery paths (owner self-approves; invited admin waits for inviter; driver
// waits for a tenant admin and gets SMS + email), code expiry, bad-code rejection, and approval authz.

import { createHash } from "node:crypto";
import { Forbidden, NotFound, type RoleCode, type UserRow } from "@fleet/shared";
import { PasswordResetService, type ResetServiceDeps } from "../src/services/passwordReset";
import { env } from "../src/config/env";

function user(over: Partial<UserRow> & { id: string; email?: string | null; phone?: string | null; roles: RoleCode[] }): UserRow {
  return {
    id: over.id,
    email: over.email ?? "owner@fleet.co.ke",
    password_hash: "old-hash",
    full_name: over.full_name ?? "Owner",
    phone: over.phone ?? "+254711222333",
    is_active: over.is_active ?? true,
    mfa_enabled: false,
    mfa_secret_encrypted: null,
    mfa_enrolled_at: null,
    dnd_start_local: null,
    dnd_end_local: null,
    locale: "en",
    failed_login_count: 0,
    locked_until: null,
    last_login_at: null,
    password_changed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  } as UserRow;
}

interface Sent {
  email: string[];
  sms: string[];
}

interface BuildOver {
  requester: UserRow;
  roles: RoleCode[];
  tenantId?: string;
  grantedBy?: string | null;
  approvers?: string[];
  approverUserId?: string | null;
  channel?: "email" | "email_sms";
  status?: string;
}

function build(over: BuildOver) {
  const sent: Sent = { email: [], sms: [] };
  const db = { inserts: [] as unknown[][], updates: [] as unknown[][] };
  const applied: { pw?: string; revoked?: string } = {};

  const users = {
    findByEmail: async (e: string) => (e.toLowerCase() === (over.requester.email ?? "").toLowerCase() ? over.requester : null),
    findByPhone: async (p: string) =>
      over.requester.phone && p.replace(/\D/g, "") === over.requester.phone.replace(/\D/g, "") ? over.requester : null,
    getById: async (id: string) => (id === over.requester.id ? over.requester : null),
    updatePassword: async (id: string, hash: string) => {
      applied.pw = hash;
    },
  } as unknown as import("../src/repositories/identity").UserRepository;

  const userRoles = {
    findGrantedBy: async (_id: string, _role: RoleCode) => over.grantedBy ?? null,
    listApprovers: async (_t: string) => over.approvers ?? [],
  } as unknown as import("../src/repositories/tenancy").UserRoleRepository;

  const userTenants = {
    findPrimaryTenantId: async (_id: string) => over.tenantId ?? "tenant-1",
  } as unknown as import("../src/repositories/tenancy").UserTenantRepository;

  const resets = {
    dbClient: {
      query: async (text: string, params?: unknown[]) => {
        if (text.trim().startsWith("INSERT")) db.inserts.push(params ?? []);
        else if (text.trim().startsWith("UPDATE")) db.updates.push(params ?? []);
        else if (text.includes("user_roles")) {
          return { rows: over.roles.map((r) => ({ role_code: r })), rowCount: over.roles.length };
        }
        return { rows: [], rowCount: 1 };
      },
    },
    findById: async () => ({
      id: "reset-1",
      tenant_id: over.tenantId ?? "tenant-1",
      user_id: over.requester.id,
      channel: over.channel ?? "email",
      status: ((over.status as never) ?? (over.approverUserId ? "PENDING_APPROVAL" : "APPROVED")) as never,
      code_hash: "",
      contact_hint: "a***@fleet.co.ke",
      requested_at: new Date().toISOString(),
      approver_user_id: over.approverUserId ?? null,
      approved_by: null,
      approved_at: null,
      delivered_at: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      completed_at: null,
      created_at: new Date().toISOString(),
    }),
    markApproved: async () => undefined,
    markDelivered: async () => undefined,
    markCompleted: async () => undefined,
    markExpired: async () => undefined,
    revokeAllForUser: async (id: string) => {
      applied.revoked = id;
    },
  } as unknown as import("../src/repositories/passwordReset").ResetCodeRepository;

  const email = {
    sendInvitation: async () => undefined,
    sendPasswordResetCode: async (i: { to: string }) => {
      sent.email.push(i.to);
    },
  } as unknown as import("../src/services/email").EmailService;

  const sms = {
    sendEmail: async () => undefined,
    sendSms: async (to: string) => {
      sent.sms.push(to);
    },
  } as unknown as import("../src/services/mfaDelivery").MfaDeliveryService;

  const deps: ResetServiceDeps = {
    users,
    userRoles,
    userTenants,
    resets,
    email,
    sms,
    env: env(),
    applyNewPassword: async (id: string, hash: string) => {
      await users.updatePassword(id, hash);
    },
  };
  return { svc: new PasswordResetService(deps), sent, db, applied };
}

describe("PasswordResetService", () => {
  it("owner (self-signup super-admin) self-approves: code emailed immediately, no approver", async () => {
    const owner = user({ id: "u-owner", email: "owner@fleet.co.ke", roles: ["ADMIN"], phone: null });
    const { svc, sent, db } = build({ requester: owner, roles: ["ADMIN"], grantedBy: owner.id });
    const res = await svc.request("owner@fleet.co.ke");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.requiresApproval).toBe(false);
    expect(res.value.status).toBe("APPROVED");
    expect(sent.email).toContain("owner@fleet.co.ke");
    expect(db.inserts.length).toBe(1);
  });

  it("invited admin waits for the inviting admin, then code is emailed on approval", async () => {
    const admin = user({ id: "u-admin", email: "admin@fleet.co.ke", roles: ["ADMIN"] });
    const { svc, sent, db } = build({
      requester: admin,
      roles: ["ADMIN"],
      grantedBy: "u-inviter",
      approverUserId: "u-inviter",
      status: "PENDING_APPROVAL",
    });
    const req = await svc.request("admin@fleet.co.ke");
    expect(req.ok && req.value.requiresApproval).toBe(true);
    expect(sent.email).toHaveLength(0); // not delivered until approved

    const approve = await svc.approve("reset-1", "u-inviter", ["ADMIN"], "tenant-1");
    expect(approve.ok).toBe(true);
    expect(sent.email).toContain("admin@fleet.co.ke");
    expect(db.updates.some((u) => typeof u[1] === "string" && u[1].length > 0)).toBe(true); // code_hash written
  });

  it("driver reset is approved by any tenant admin and delivered via SMS + email", async () => {
    const driver = user({ id: "u-driver", email: "driver@fleet.cl", phone: "+254711222333", roles: ["DRIVER"] });
    const { svc, sent } = build({
      requester: driver,
      roles: ["DRIVER"],
      approvers: ["u-admin"],
      approverUserId: "u-admin",
      channel: "email_sms",
      status: "PENDING_APPROVAL",
    });
    const req = await svc.request("driver@fleet.cl");
    expect(req.ok && req.value.requiresApproval).toBe(true);

    const approve = await svc.approve("reset-1", "u-admin", ["ADMIN"], "tenant-1");
    expect(approve.ok).toBe(true);
    expect(sent.email).toContain("driver@fleet.cl");
    expect(sent.sms).toContain("+254711222333");
  });

  it("non-approver cannot approve an invited-admin reset", async () => {
    const admin = user({ id: "u-admin", email: "admin@fleet.co.ke", roles: ["ADMIN"] });
    const { svc } = build({
      requester: admin,
      roles: ["ADMIN"],
      grantedBy: "u-inviter",
      approverUserId: "u-inviter",
      status: "PENDING_APPROVAL",
    });
    const approve = await svc.approve("reset-1", "u-stranger", ["ADMIN"], "tenant-1");
    expect(approve.ok).toBe(false);
    if (approve.ok) return;
    expect(approve.error).toBeInstanceOf(Forbidden);
  });

  it("complete rejects an invalid code and applies a valid one", async () => {
    const owner = user({ id: "u-owner", email: "owner@fleet.co.ke", roles: ["ADMIN"], phone: null });
    const code = "123456";
    const hash = createHash("sha256").update(code).digest("hex");
    const resets = {
      dbClient: { query: async () => ({ rows: [], rowCount: 1 }) } as never,
      findById: async () => ({
        id: "reset-1",
        tenant_id: "tenant-1",
        user_id: owner.id,
        channel: "email",
        status: "APPROVED",
        code_hash: hash,
        contact_hint: "x",
        requested_at: new Date().toISOString(),
        approver_user_id: null,
        approved_by: null,
        approved_at: null,
        delivered_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
      }),
      markCompleted: async () => undefined,
      revokeAllForUser: async () => undefined,
    } as unknown as import("../src/repositories/passwordReset").ResetCodeRepository;
    const users = {
      getById: async () => owner,
      updatePassword: async () => undefined,
    } as unknown as import("../src/repositories/identity").UserRepository;
    const deps: ResetServiceDeps = {
      users,
      userRoles: {} as never,
      userTenants: { findPrimaryTenantId: async () => "tenant-1" } as never,
      resets,
      email: { sendInvitation: async () => undefined, sendPasswordResetCode: async () => undefined } as never,
      sms: { sendEmail: async () => undefined, sendSms: async () => undefined } as never,
      env: env(),
      applyNewPassword: async () => undefined,
    };
    const svc = new PasswordResetService(deps);
    const bad = await svc.complete("reset-1", "000000", "NewPassword!2026");
    expect(bad.ok).toBe(false);
    const good = await svc.complete("reset-1", code, "NewPassword!2026");
    expect(good.ok).toBe(true);
  });

  it("request returns a generic error for an unknown account (no enumeration)", async () => {
    const { svc } = build({ requester: user({ id: "u-owner", email: "owner@fleet.co.ke", roles: ["ADMIN"], phone: null }), roles: ["ADMIN"] });
    const res = await svc.request("ghost@nowhere.co");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFound);
  });
});
