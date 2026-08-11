// packages/api/src/services/passwordReset.ts
// Delegated password-reset (immune-system follow-on).
//
// A reset is REQUESTED by the account owner via the reset link. Delivery of the code is gated by
// role, mirroring the invite trust model (14_tenancy.sql):
//   * company OWNER (the self-signup super-admin, ADMIN with granted_by = self)
//        → no approval; a fresh code is generated and emailed immediately.
//   * INVITED ADMIN  → approver is the inviting admin (user_roles.granted_by); after that admin
//        approves, a fresh code is generated and emailed to the invitee.
//   * DRIVER         → approver is any tenant ADMIN / FLEET_MANAGER; after approval a fresh code is
//        generated and delivered to BOTH the driver's mobile number (SMS) and their email.
//
// The code is numeric, single-use, hashed at rest (SHA-256), and expires after
// PASSWORD_RESET_CODE_TTL_MINUTES. It is generated only when the row becomes APPROVED (at request
// time for owners, at approval time for everyone else), so an unapproved request never holds a live
// code. The raw code is NEVER returned in an API response — only delivered out-of-band.

import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  ConflictError,
  Forbidden,
  NotFound,
  Unauthenticated,
  err,
  logger,
  ok,
  type Result,
  type RoleCode,
  type UserRow,
} from "@fleet/shared";
import { argon2idHasher } from "../security/passwords";
import type { Env } from "../config/env";
import type { ResetCodeRepository } from "../repositories/passwordReset";
import type { UserRepository } from "../repositories/identity";
import type { UserRoleRepository, UserTenantRepository } from "../repositories/tenancy";
import type { EmailService, PasswordResetEmailInput } from "./email";
import type { MfaDeliveryService } from "./mfaDelivery";

export interface ResetRequestResult {
  resetId: string;
  status: "PENDING_APPROVAL" | "APPROVED";
  /** Redacted destination the code travels to — never the raw code. */
  contactHint: string;
  expiresAt: string;
  /** True when an admin must approve before the code is delivered. */
  requiresApproval: boolean;
}

export interface ResetServiceDeps {
  users: UserRepository;
  userRoles: UserRoleRepository;
  userTenants: UserTenantRepository;
  resets: ResetCodeRepository;
  email: EmailService;
  sms: MfaDeliveryService;
  env: Env;
  /** Applies the new password hash + revokes all sessions atomically with the caller's transaction. */
  applyNewPassword: (userId: string, newPasswordHash: string) => Promise<void>;
}

export class PasswordResetService {
  constructor(private readonly d: ResetServiceDeps) {}

  private hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  private redactEmail(email: string): string {
    const parts = email.split("@");
    const local = parts[0] ?? "";
    const domain = parts[1] ?? email;
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private redactPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) return "***";
    return `${digits.slice(0, digits.length - 3).replace(/\d/g, "*")}${digits.slice(-3)}`;
  }

  /**
   * Resolve the approver + delivery channel for a user's reset, following the invite trust model.
   * Returns `approverUserId: null` when the owner self-approves (no human gate needed).
   */
  private async resolveApproval(input: {
    userId: string;
    roles: RoleCode[];
    tenantId: string;
  }): Promise<{ approverUserId: string | null; channel: "email" | "email_sms" }> {
    if (input.roles.includes("DRIVER")) {
      const admins = await this.d.userRoles.listApprovers(input.tenantId);
      return { approverUserId: admins[0] ?? null, channel: "email_sms" };
    }
    if (input.roles.includes("ADMIN")) {
      const grantedBy = await this.d.userRoles.findGrantedBy(input.userId, "ADMIN");
      if (!grantedBy || grantedBy === input.userId) {
        return { approverUserId: null, channel: "email" };
      }
      return { approverUserId: grantedBy, channel: "email" };
    }
    const admins = await this.d.userRoles.listApprovers(input.tenantId);
    return { approverUserId: admins[0] ?? null, channel: "email" };
  }

  /** Generates a fresh numeric code, stores only its hash + a fresh expiry, and returns the raw code. */
  private async issueCode(rowId: string): Promise<{ code: string; expiresAt: Date }> {
    const len = this.d.env.PASSWORD_RESET_CODE_LENGTH;
    const code = String(randomInt(10 ** (len - 1), 10 ** len));
    const expiresAt = new Date(Date.now() + this.d.env.PASSWORD_RESET_CODE_TTL_MINUTES * 60_000);
    await this.d.resets.dbClient.query(
      `UPDATE app.password_reset_codes SET code_hash = $2, expires_at = $3 WHERE id = $1`,
      [rowId, this.hashCode(code), expiresAt],
    );
    return { code, expiresAt };
  }

  private async deliver(user: UserRow, code: string, channel: "email" | "email_sms", expiresAt: Date): Promise<void> {
    const input: PasswordResetEmailInput = {
      to: user.email ?? "",
      fullName: user.full_name,
      contactHint:
        channel === "email_sms" && user.phone ? this.redactPhone(user.phone) : this.redactEmail(user.email ?? "owner"),
      code,
      expiresAt,
    };
    if (user.email) await this.d.email.sendPasswordResetCode(input);
    if (channel === "email_sms" && user.phone) {
      await this.d.sms.sendSms(user.phone, `Your Fleet password-reset code is ${code}. It expires soon.`);
    }
  }

  /**
   * `POST /auth/password-reset/request`. Unauthenticated — the reset link is public, but it only
   * creates a (pending) reset and reveals a redacted contact hint, never the code. Owners skip
   * approval and receive the code by email immediately; everyone else waits for an approver.
   */
  async request(emailOrPhone: string): Promise<Result<ResetRequestResult>> {
    const byPhone = /^\+?\d[\d\s-]{6,}$/.test(emailOrPhone.trim());
    const user: UserRow | null = byPhone
      ? await this.d.users.findByPhone(emailOrPhone)
      : await this.d.users.findByEmail(emailOrPhone.trim().toLowerCase());
    if (!user) {
      return err(new NotFound("If an account matches, a reset has been initiated."));
    }
    if (!user.is_active) return err(new Unauthenticated("Account is not active"));

    const tenantId = await this.d.userTenants.findPrimaryTenantId(user.id);
    const roles = await this.resolveRoles(user.id);
    const { approverUserId, channel } = await this.resolveApproval({ userId: user.id, roles, tenantId });

    const contactHint =
      channel === "email_sms"
        ? `${this.redactEmail(user.email ?? "owner")} / ${user.phone ? this.redactPhone(user.phone) : "no-phone"}`
        : this.redactEmail(user.email ?? "owner");

    const id = randomUUID();
    const initialExpiry = new Date(Date.now() + this.d.env.PASSWORD_RESET_CODE_TTL_MINUTES * 60_000);
    await this.d.resets.dbClient.query(
      `INSERT INTO app.password_reset_codes
         (id, tenant_id, user_id, channel, status, code_hash, contact_hint, approver_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        tenantId,
        user.id,
        channel,
        approverUserId ? "PENDING_APPROVAL" : "APPROVED",
        this.hashCode(""), // placeholder; real code issued below for APPROVED rows
        contactHint,
        approverUserId,
        initialExpiry,
      ],
    );

    if (!approverUserId) {
      const { code, expiresAt } = await this.issueCode(id);
      await this.deliver(user, code, channel, expiresAt).catch((e) =>
        logger.warn("passwordReset: owner code delivery failed", { userId: user.id, message: (e as Error).message }),
      );
      await this.d.resets.markDelivered(id);
    }

    return ok({
      resetId: id,
      status: approverUserId ? "PENDING_APPROVAL" : "APPROVED",
      contactHint,
      expiresAt: initialExpiry.toISOString(),
      requiresApproval: approverUserId !== null,
    });
  }

  /** Resolves a user's role union (DRIVER first, then ADMIN/others). */
  private async resolveRoles(userId: string): Promise<RoleCode[]> {
    const res = await this.d.resets.dbClient.query<{ role_code: RoleCode }>(
      `SELECT role_code FROM app.user_roles WHERE user_id = $1`,
      [userId],
    );
    return res.rows.map((r) => r.role_code);
  }

  /**
   * `POST /auth/password-reset/{id}/approve`. Authenticated admin. Only the designated approver
   * (or, for drivers, any tenant admin) may approve; approval issues + delivers a fresh code.
   */
  async approve(
    resetId: string,
    actorUserId: string,
    actorRoles: RoleCode[],
    actorTenantId: string,
  ): Promise<Result<{ delivered: boolean; channel: "email" | "email_sms" }>> {
    const row = await this.d.resets.findById(resetId);
    if (!row || row.status === "COMPLETED" || row.status === "EXPIRED" || row.status === "REVOKED") {
      return err(new NotFound("Reset request not found or no longer valid"));
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.d.resets.markExpired(row.id);
      return err(new NotFound("Reset request has expired"));
    }
    if (row.status !== "PENDING_APPROVAL") {
      return err(new ConflictError("RESET_ALREADY_APPROVED", "Already approved", "This reset has already been approved"));
    }

    const isDesignated = row.approver_user_id === actorUserId;
    const isTenantAdmin = actorRoles.includes("ADMIN") || actorRoles.includes("FLEET_MANAGER");
    // Invited admins: only the inviting admin. Drivers: any tenant admin.
    const authorised = isDesignated || (row.channel === "email_sms" && isTenantAdmin && actorTenantId === row.tenant_id);
    if (!authorised) return err(new Forbidden("You are not authorised to approve this reset"));

    await this.d.resets.markApproved(row.id, actorUserId);
    const user = await this.d.users.getById(row.user_id);
    if (!user) return err(new NotFound("Account no longer exists"));
    const { code, expiresAt } = await this.issueCode(row.id);
    try {
      await this.deliver(user, code, row.channel, expiresAt);
      await this.d.resets.markDelivered(row.id);
    } catch (e) {
      logger.warn("passwordReset: code delivery failed after approval", { resetId, message: (e as Error).message });
    }
    return ok({ delivered: true, channel: row.channel });
  }

  /**
   * `POST /auth/password-reset/complete`. Unauthenticated — the reset id + code ARE the credential.
   * Validates the code (hash match, APPROVED, unexpired), applies the new password, revokes all
   * sessions, and retires the reset so it cannot be replayed.
   */
  async complete(resetId: string, code: string, newPassword: string): Promise<Result<{ reset: boolean }>> {
    const row = await this.d.resets.findById(resetId);
    if (!row) return err(new NotFound("Reset request not found"));
    if (row.status === "COMPLETED" || row.status === "REVOKED") {
      return err(new Unauthenticated("This reset link has already been used"));
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.d.resets.markExpired(row.id);
      return err(new Unauthenticated("This reset link has expired"));
    }
    if (row.status !== "APPROVED") {
      return err(
        new ConflictError("RESET_NOT_APPROVED", "Not approved", "This reset must be approved by an admin before you can set a new password"),
      );
    }
    const expected = this.hashCode(code);
    const got = Buffer.from(expected);
    const have = Buffer.from(row.code_hash);
    if (got.length !== have.length || !timingSafeEqual(got, have)) {
      return err(new Unauthenticated("Invalid reset code"));
    }

    const hash = await argon2idHasher.hash(newPassword);
    await this.d.applyNewPassword(row.user_id, hash);
    await this.d.resets.markCompleted(row.id);
    await this.d.resets.revokeAllForUser(row.user_id, "REVOKED");
    return ok({ reset: true });
  }
}
