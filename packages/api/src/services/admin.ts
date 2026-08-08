// packages/api/src/services/admin.ts
// Admin console commands (A3.7): driver roster read, driver creation + approval, device revoke, and
// forced global sign-out. Revoke by device primary key; session revoke reuses the existing logout-all
// path so it invalidates every active session for the target user (10-session cap / B13).

import type { Result } from "@fleet/shared";
import { ValidationError, err, ok } from "@fleet/shared";
import { argon2idHasher } from "../security/passwords";
import { checkPasswordStrength } from "../security/passwordPolicy";
import type { AdminRepository, DriverRosterRow } from "../repositories/admin";
import type { UserRepository, DriverRepository } from "../repositories/identity";
import type { DeviceService } from "./device";
import type { AuthService } from "./auth";

export interface ListDriversResult {
  data: DriverRosterRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateDriverInput {
  phone: string;
  fullName: string;
  password: string;
  licenceNumber?: string | null;
  licenceClass?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

export class AdminService {
  constructor(
    private readonly admin: AdminRepository,
    private readonly users: UserRepository,
    private readonly drivers: DriverRepository,
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
      hasMore && last ? encodeCursor({ sort: last.user.full_name, id: last.user.id }) : null;
    return ok({ data, nextCursor, hasMore });
  }

  /**
   * Creates a driver account (PENDING approval). The driver signs in with their phone number; the
   * password is hashed with argon2id and the strength policy is enforced. Until an admin approves,
   * the driver cannot sign in (the DRIVER row stays PENDING).
   */
  async createDriver(input: CreateDriverInput): Promise<Result<{ userId: string; status: "PENDING" }>> {
    const phone = input.phone.trim();
    const existing = await this.users.findByPhone(phone);
    if (existing) {
      return err(
        new ValidationError("Phone number already registered", [
          { field: "phone", code: "PHONE_TAKEN", message: "A driver with this phone number already exists." },
        ]),
      );
    }

    const strength = checkPasswordStrength(input.password, phone);
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
    const user = await this.users.create({
      phone,
      passwordHash: hash,
      fullName: input.fullName.trim(),
      isActive: false,
      mfaEnabled: false,
    });
    await this.users.assignRole(user.id, "DRIVER");
    await this.drivers.create({
      userId: user.id,
      licenceNumber: input.licenceNumber ?? null,
      licenceClass: input.licenceClass ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      status: "PENDING",
    });
    return ok({ userId: user.id, status: "PENDING" });
  }

  /** Approves a PENDING driver so they can sign in (A3.7). */
  async approveDriver(userId: string): Promise<Result<{ ok: true }>> {
    const driver = await this.drivers.findByUserId(userId);
    if (!driver) return err(new ValidationError("Driver not found", [{ field: "user_id", code: "NOT_FOUND", message: "No driver profile for this user." }]));
    await this.drivers.setStatus(userId, "ACTIVE");
    await this.users.setActive(userId, true);
    return ok({ ok: true });
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
