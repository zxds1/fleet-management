// packages/api/test/admin.routes.test.ts
// Unit tests for the admin transport-layer mapping (http/routes/admin.ts): the DriverSummary shape
// the mobile app consumes is produced here (not in the service). Covers platform derivation from
// push provider, status derivation from is_active, null-safety of optional fields, and device list
// ordering. No DB — these are pure functions.

import { platformOf, toDriverSummary } from "../src/http/routes/admin";
import type { UserRow, DriverDeviceRow } from "@fleet/shared";

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "u1",
    email: "amy@fleet.co.ke",
    password_hash: "x",
    full_name: "Amy",
    phone: null,
    is_active: true,
    mfa_enabled: true,
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
    ...overrides,
  };
}

function device(id: string, provider = "fcm", lastSeen: string | null = null): DriverDeviceRow {
  return {
    id, user_id: "u1", device_id_hash: "h", device_label: null, device_model: null, os_version: null,
    app_version: null, push_token: null, push_provider: provider, push_token_updated_at: null,
    biometric_enrolled: false,
    // PIN + offline-lock columns (13_device_pin_offline.sql): a freshly registered device has none.
    pin_set_at: null, refresh_token_hash: null, refresh_token_expires_at: null,
    offline_window_expires_at: null, offline_pin_failures: 0, offline_locked_until: null,
    last_seen_online_at: lastSeen, revoked_at: null, revoked_by: null, revoked_reason: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

describe("platformOf", () => {
  it("maps apns → ios and everything else → android", () => {
    expect(platformOf("apns")).toBe("ios");
    expect(platformOf("fcm")).toBe("android");
    expect(platformOf("gcm")).toBe("android");
  });
});

describe("toDriverSummary", () => {
  it("maps a user + devices to the mobile DriverSummary shape", () => {
    const row = {
      user: user({ full_name: "Amy", is_active: true, last_login_at: "2026-08-07T10:00:00.000Z" }),
      devices: [device("d1", "apns", "2026-08-07T09:00:00.000Z"), device("d2", "fcm", null)],
    };
    expect(toDriverSummary(row)).toEqual({
      user_id: "u1",
      email: "amy@fleet.co.ke",
      full_name: "Amy",
      mfa_enrolled: true,
      status: "ACTIVE",
      last_login_at: "2026-08-07T10:00:00.000Z",
      devices: [
        { device_id: "d1", platform: "ios", last_seen_at: "2026-08-07T09:00:00.000Z" },
        { device_id: "d2", platform: "android", last_seen_at: null },
      ],
    });
  });

  it("derives SUSPENDED from an inactive account", () => {
    const row = { user: user({ is_active: false }), devices: [] };
    expect(toDriverSummary(row).status).toBe("SUSPENDED");
  });

  it("null-safely handles a missing full_name and empty device list", () => {
    const row = { user: user({ full_name: undefined }), devices: [] };
    const summary = toDriverSummary(row);
    expect(summary.full_name).toBeNull();
    expect(summary.devices).toEqual([]);
  });
});
