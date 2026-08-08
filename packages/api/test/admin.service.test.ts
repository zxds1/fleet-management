// packages/api/test/admin.service.test.ts
// Unit tests for AdminService (A3.7): driver roster cursor page, device revoke, and forced global
// sign-out. Uses fakes for the repository + device/auth services — no DB. The DriverSummary mapping
// (devices/platform/status) lives in the transport layer (http/routes/admin.ts); here we assert the
// raw roster rows + cursor envelope the service returns.

import { ok } from "@fleet/shared";
import { AdminService } from "../src/services/admin";
import type { AdminRepository, DriverRosterRow, ListDriversOptions } from "../src/repositories/admin";
import type { UserRepository, DriverRepository } from "../src/repositories/identity";
import type { DeviceService } from "../src/services/device";
import type { AuthService } from "../src/services/auth";
import type { UserRow, DriverDeviceRow } from "@fleet/shared";

function user(id: string, email: string, isActive = true): UserRow {
  return {
    id, email, password_hash: "x", full_name: email.split("@")[0] ?? email, phone: null,
    is_active: isActive, mfa_enabled: true, mfa_secret_encrypted: null, mfa_enrolled_at: null,
    dnd_start_local: null, dnd_end_local: null, locale: "en", failed_login_count: 0,
    locked_until: null, last_login_at: null, password_changed_at: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
  };
}

function device(id: string, provider = "fcm"): DriverDeviceRow {
  return {
    id, user_id: "u", device_id_hash: "h", device_label: null, device_model: null, os_version: null,
    app_version: null, push_token: null, push_provider: provider, push_token_updated_at: null,
    biometric_enrolled: false, last_seen_online_at: null, revoked_at: null, revoked_by: null,
    revoked_reason: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

function cursorAwareRepo(rows: DriverRosterRow[]): AdminRepository {
  return {
    listDrivers: async (opts: ListDriversOptions) => {
      if (!opts.cursor) return rows;
      const start = rows.findIndex(
        (r) => r.user.full_name === opts.cursor!.sort && r.user.id === opts.cursor!.id,
      );
      return start >= 0 ? rows.slice(start + 1) : rows;
    },
  } as unknown as AdminRepository;
}

describe("AdminService", () => {
  it("returns a cursor page of raw roster rows (limit+1 fetch → has_more)", async () => {
    const rows: DriverRosterRow[] = [
      { user: user("u1", "amy@fleet.co.ke"), driverStatus: "ACTIVE", devices: [device("d1", "apns"), device("d2", "fcm")] },
      { user: user("u2", "bob@fleet.co.ke", false), driverStatus: "SUSPENDED", devices: [] },
      { user: user("u3", "cara@fleet.co.ke"), driverStatus: "ACTIVE", devices: [] },
    ];
    const adminRepo: AdminRepository = { listDrivers: async () => rows } as unknown as AdminRepository;
    const svc = new AdminService(adminRepo, {} as UserRepository, {} as DriverRepository, {} as DeviceService, {} as AuthService);

    const res = await svc.listDrivers({ limit: 2 });
    if (!res.ok) throw new Error("expected ok");
    const page = res.value;
    // 3 rows fetched for limit 2 → has_more true, last row dropped from data
    expect(page.hasMore).toBe(true);
    expect(page.data).toHaveLength(2);
    expect(page.data[0]!.user.id).toBe("u1");
    // raw devices are carried through untouched (mapping happens at transport layer)
    expect(page.data[0]!.devices.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(page.data[1]!.user.is_active).toBe(false);
    // next cursor encodes email+id of the last returned row
    expect(page.nextCursor).toBeTruthy();
  });

  it("decodes an opaque cursor back to (email,id) and advances the page", async () => {
    const all: DriverRosterRow[] = [
      { user: user("u1", "amy@fleet.co.ke"), driverStatus: "ACTIVE", devices: [] },
      { user: user("u2", "bob@fleet.co.ke"), driverStatus: "ACTIVE", devices: [] },
    ];
    const svc = new AdminService(cursorAwareRepo(all), {} as UserRepository, {} as DriverRepository, {} as DeviceService, {} as AuthService);
    const first = await svc.listDrivers({ limit: 1 });
    if (!first.ok) throw new Error("expected ok");
    const cursor = first.value.nextCursor!;
    const second = await svc.listDrivers({ limit: 1, cursor });
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.data[0]!.user.id).toBe("u2");
  });

  it("revokes a device by id through the device service", async () => {
    let revokedId: string | null = null;
    const deviceSvc: DeviceService = {
      revokeById: async (id: string) => {
        revokedId = id;
        return ok({ ok: true });
      },
    } as unknown as DeviceService;
    const svc = new AdminService({} as AdminRepository, {} as UserRepository, {} as DriverRepository, deviceSvc, {} as AuthService);
    const res = await svc.revokeDevice("d9", "admin-1");
    expect(res.ok).toBe(true);
    expect(revokedId).toBe("d9");
  });

  it("forces global sign-out through auth.logoutAll", async () => {
    let loggedOut: string | null = null;
    const authSvc: AuthService = {
      logoutAll: async (userId: string) => {
        loggedOut = userId;
      },
    } as unknown as AuthService;
    const svc = new AdminService({} as AdminRepository, {} as UserRepository, {} as DriverRepository, {} as DeviceService, authSvc);
    const res = await svc.revokeSessions("u-target");
    expect(res.ok).toBe(true);
    expect(loggedOut).toBe("u-target");
  });
});
