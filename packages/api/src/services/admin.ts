// packages/api/src/services/admin.ts
// Admin console commands (A3.7): driver roster read, device revoke, and forced global sign-out.
// Revoke by device primary key; session revoke reuses the existing logout-all path so it invalidates
// every active session for the target user (10-session cap / B13).

import type { Result, RoleCode, UserRow } from "@fleet/shared";
import { conflict, NotFound, ok, err } from "@fleet/shared";
import type { AdminRepository, DriverDetailRow, DriverRosterRow } from "../repositories/admin";
import type { DeviceService } from "./device";
import type { AuthService } from "./auth";

export interface ListDriversResult {
  data: DriverRosterRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateDriverCommand {
  email: string;
  fullName: string;
  phone?: string | null;
  roles?: RoleCode[];
  createdBy: string;
}

/**
 * Invited users are created inactive with an unusable password hash: they cannot authenticate
 * until an admin approves them and a real credential is set (argon2id, never a plaintext value).
 */
const UNUSABLE_PASSWORD_HASH = "!invited";

export class AdminService {
  constructor(
    private readonly admin: AdminRepository,
    private readonly device: DeviceService,
    private readonly auth: AuthService,
  ) {}

  /** Cursor-paginated driver roster. `limit + 1` rows are fetched so `has_more` needs no count query. */
  async listDrivers(opts: {
    status?: "ACTIVE" | "SUSPENDED";
    cursor?: string | null;
    limit: number;
  }): Promise<Result<ListDriversResult>> {
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await this.admin.listDrivers({
      status: opts.status,
      cursor: decoded,
      limit: opts.limit,
    });
    const hasMore = rows.length > opts.limit;
    const data = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ sort: last.user.email ?? "", id: last.user.id }) : null;
    return ok({ data, nextCursor, hasMore });
  }

  /** Single driver with roles + permissions for the admin detail screen. */
  async getDriver(userId: string): Promise<Result<DriverDetailRow>> {
    const row = await this.admin.getDriver(userId);
    if (!row) return err(new NotFound("Driver not found"));
    return ok(row);
  }

  /** Approves a pending driver by activating the account (status derives from is_active). */
  async approveDriver(userId: string): Promise<Result<UserRow>> {
    const row = await this.admin.getDriver(userId);
    if (!row) return err(new NotFound("Driver not found"));
    if (row.user.is_active) {
      return err(conflict("DRIVER_ALREADY_ACTIVE", "Driver already approved", "The driver account is already active."));
    }
    const updated = await this.admin.setActive(userId, true);
    if (!updated) return err(new NotFound("Driver not found"));
    return ok(updated);
  }

  /** Creates (invites) a driver. Email uniqueness is enforced on live rows only (D3). */
  async createDriver(input: CreateDriverCommand): Promise<Result<UserRow>> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.admin.findLiveByEmail(email);
    if (existing) {
      return err(conflict("EMAIL_TAKEN", "Email already registered", "A live user already uses this email."));
    }
    const roles = input.roles && input.roles.length > 0 ? input.roles : (["DRIVER"] as RoleCode[]);
    const user = await this.admin.createDriver({
      email,
      fullName: input.fullName.trim(),
      phone: input.phone ?? null,
      roles,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      grantedBy: input.createdBy,
    });
    return ok(user);
  }

  /** Suspends a user and drops every live session so the block takes effect immediately. */
  async suspendUser(userId: string): Promise<Result<UserRow>> {
    const updated = await this.admin.setActive(userId, false);
    if (!updated) return err(new NotFound("User not found"));
    await this.auth.logoutAll(userId);
    return ok(updated);
  }

  /** Reinstates a suspended user. */
  async reinstateUser(userId: string): Promise<Result<UserRow>> {
    const updated = await this.admin.setActive(userId, true);
    if (!updated) return err(new NotFound("User not found"));
    return ok(updated);
  }

  /**
   * Updates the calling user's own profile (`PUT /admin/users/me`). The user id is the resolved
   * principal, never a request field, so this can only ever edit the caller.
   */
  async updateOwnProfile(
    userId: string,
    input: { full_name?: string; phone?: string | null; locale?: string },
  ): Promise<Result<UserRow>> {
    const updated = await this.admin.updateProfile(userId, input);
    if (!updated) return err(new NotFound("User not found"));
    return ok(updated);
  }

  /** The caller's own profile row (`GET /admin/users/me`). Target is always the principal. */
  async getOwnProfile(userId: string): Promise<Result<UserRow>> {
    const user = await this.admin.findLiveById(userId);
    if (!user) return err(new NotFound("User not found"));
    return ok(user);
  }

  /** Revokes one device (forces the driver to re-authenticate). `deviceId` is the device PK. */
  async revokeDevice(deviceId: string, by: string): Promise<Result<{ ok: true }>> {
    return this.device.revokeById(deviceId, by);
  }

  /** Forces a global sign-out for a user: invalidates every active session. */
  async revokeSessions(userId: string): Promise<Result<{ ok: true }>> {
    await this.auth.logoutAll(userId);
    return ok({ ok: true });
  }
}

function encodeCursor(c: { sort: string; id: string }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): { sort: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (parsed && typeof parsed === "object" && "sort" in parsed && "id" in parsed) {
      return { sort: String((parsed as { sort: string }).sort), id: String((parsed as { id: string }).id) };
    }
    return null;
  } catch {
    return null;
  }
}
