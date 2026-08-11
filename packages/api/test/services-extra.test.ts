// packages/api/test/services-extra.test.ts
// Closes the service-coverage gap (P1#3): unit tests for the auth-support services that previously
// had no tests — MFA, sessions (incl. the 10-session cap + Redis degradation), driver devices, and
// the consent ledger. All collaborators are faked; totp is mocked so verify() is deterministic.
import { ok, err, Unauthenticated, ValidationError, DeviceRevoked, NotFound, ConsentRequired } from "@fleet/shared";
import { MfaService } from "../src/services/mfa";
import type { OtpStore } from "../src/security/otpStore";
import { SessionService } from "../src/services/session";
import { DeviceService } from "../src/services/device";
import { ConsentService } from "../src/services/consent";

describe("MfaService", () => {
  function makeOtp(): OtpStore & { codes: Map<string, string>; attempts: Map<string, number> } {
    const codes = new Map<string, string>();
    const attempts = new Map<string, number>();
    return {
      codes,
      attempts,
      async get(u) {
        return codes.get(u) ?? null;
      },
      async set(u, c) {
        codes.set(u, c);
      },
      async delete(u) {
        codes.delete(u);
        attempts.delete(u);
      },
      async incrementAttempts(u) {
        const n = (attempts.get(u) ?? 0) + 1;
        attempts.set(u, n);
        return n;
      },
      async resetAttempts(u) {
        attempts.delete(u);
      },
    };
  }

  const users: any = {
    getById: jest.fn(),
    activateMfa: jest.fn(async () => undefined),
  };
  const recovery: any = { replaceAll: jest.fn(async () => undefined), consume: jest.fn(async () => false) };
  const tokens: any = { verifyMfaChallenge: jest.fn(() => ({ userId: "u1" })) };
  const sessions: any = {
    issue: jest.fn(async () => ok({ sessionId: "s1", userId: "u1", accessToken: "a", accessTokenExpiresAt: new Date(), refreshToken: "r", refreshTokenExpiresAt: new Date() })),
  };
  const delivery: any = {
    sendEmail: jest.fn(async () => undefined),
    sendSms: jest.fn(async () => undefined),
  };

  function build(roles: string[]) {
    const permissions: any = {
      resolve: jest.fn(async () => ({ roles: roles as any, permissions: [], requiresMfa: false })),
    };
    const otp = makeOtp();
    const svc = new MfaService(users, recovery, permissions, tokens, sessions, otp, delivery);
    return { svc, otp, permissions };
  }

  beforeEach(() => jest.clearAllMocks());

  it("enrols and activates MFA, returning 10 recovery codes", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c" });
    const { svc } = build([]);
    const r = await svc.enroll("u1");
    expect(r.ok).toBe(true);
    expect(recovery.replaceAll).toHaveBeenCalled();
    expect(users.activateMfa).toHaveBeenCalledWith("u1");
    expect((r as any).value.recoveryCodes).toHaveLength(10);
  });

  it("enrol fails for unknown user", async () => {
    users.getById.mockResolvedValue(null);
    const { svc } = build([]);
    expect((await svc.enroll("x")).ok).toBe(false);
  });

  it("sendCode routes a driver with a phone number to SMS", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", phone: "+254700000000", mfa_enabled: true });
    const { svc, otp } = build(["DRIVER"]);
    const r = await svc.sendCode("u1");
    expect(r.ok).toBe(true);
    expect(delivery.sendSms).toHaveBeenCalledTimes(1);
    expect(delivery.sendEmail).not.toHaveBeenCalled();
    expect(otp.codes.get("u1")).toMatch(/^\d{6}$/);
  });

  it("sendCode routes an admin without a driver role to email", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "admin@b.c", phone: null, mfa_enabled: true });
    const { svc } = build(["ADMIN"]);
    const r = await svc.sendCode("u1");
    expect(r.ok).toBe(true);
    expect(delivery.sendEmail).toHaveBeenCalledTimes(1);
    expect(delivery.sendSms).not.toHaveBeenCalled();
  });

  it("blocks login when no deliverable contact exists", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: null, phone: null, mfa_enabled: true });
    const { svc } = build(["DRIVER"]);
    const r = await svc.sendCode("u1");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(ValidationError);
    expect(delivery.sendSms).not.toHaveBeenCalled();
    expect(delivery.sendEmail).not.toHaveBeenCalled();
  });

  it("reuses the same code on a repeat sendCode (no regeneration)", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", phone: "+254700000000", mfa_enabled: true });
    const { svc, otp } = build(["DRIVER"]);
    await svc.sendCode("u1");
    const first = otp.codes.get("u1");
    await svc.sendCode("u1");
    expect(otp.codes.get("u1")).toBe(first);
    expect(delivery.sendSms).toHaveBeenCalledTimes(2);
  });

  it("verify issues a session for the correct OTP and clears it", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: true });
    const { svc, otp } = build([]);
    otp.codes.set("u1", "123456");
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(true);
    expect(sessions.issue).toHaveBeenCalled();
    expect(otp.codes.get("u1")).toBeUndefined();
  });

  it("verify rejects when MFA is not configured", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: false });
    const { svc } = build([]);
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(Unauthenticated);
  });

  it("verify consumes a recovery code", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: true });
    const { svc } = build([]);
    recovery.consume.mockResolvedValueOnce(true);
    const r = await svc.verify("chal", "RECOVERY-CODE");
    expect(r.ok).toBe(true);
    expect(recovery.consume).toHaveBeenCalledWith("u1", expect.any(String));
  });

  it("verify rejects an invalid code and increments attempts", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: true });
    const { svc, otp } = build([]);
    otp.codes.set("u1", "123456");
    const r = await svc.verify("chal", "000000");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(ValidationError);
    expect(otp.attempts.get("u1")).toBe(1);
  });

  it("verify invalidates the code after the attempt cap is exceeded", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: true });
    const { svc, otp } = build([]);
    otp.codes.set("u1", "123456");
    for (let i = 0; i < 5; i++) await svc.verify("chal", "000000");
    expect(otp.codes.get("u1")).toBeUndefined();
    // A 6th attempt after invalidation is rejected with the "no active code" error.
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(false);
  });

  it("verify rejects when no active code exists", async () => {
    users.getById.mockResolvedValue({ id: "u1", email: "a@b.c", mfa_enabled: true });
    const { svc } = build([]);
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(ValidationError);
  });
});

describe("SessionService", () => {
  const sessionsRepo: any = {
    create: jest.fn(async () => ({ id: "s1" })),
    findActiveByTokenHash: jest.fn(),
    rotate: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
    revokeAllForUser: jest.fn(async () => undefined),
    listActive: jest.fn(async () => [{ id: "s1" }]),
  };
  const store: any = {
    available: true,
    add: jest.fn(async () => []),
    remove: jest.fn(async () => undefined),
    removeAll: jest.fn(async () => undefined),
  };
  const tokens: any = {
    issueRefreshToken: jest.fn(() => ({ token: "rt", expiresAt: new Date() })),
    issueAccessToken: jest.fn(() => ({ token: "at", expiresAt: new Date() })),
  };
  const config: any = { numeric: jest.fn(async () => 10) };
  const resolveIdentity = jest.fn(async () => ({ email: "a@b.c", phone: null, tenantId: "00000000-0000-0000-0000-000000000001", roles: ["DRIVER"] as any, permissions: [], locale: "en" as const }));
  const svc = new SessionService(sessionsRepo, store, tokens, config, resolveIdentity);

  beforeEach(() => jest.clearAllMocks());

  it("issues a session and returns signed tokens", async () => {
    const r = await svc.issue({ userId: "u1" });
    expect(r.ok).toBe(true);
    expect(tokens.issueAccessToken).toHaveBeenCalled();
    expect((r as any).value.sessionId).toBe("s1");
  });

  it("evicts beyond the cap when Redis is available", async () => {
    store.add.mockResolvedValue(["old"]);
    const r = await svc.issue({ userId: "u1" });
    expect(r.ok).toBe(true);
    expect(sessionsRepo.revoke).toHaveBeenCalledWith("old", "SESSION_LIMIT_EXCEEDED");
  });

  it("degrades to DB count when Redis is unavailable", async () => {
    store.available = false;
    const r = await svc.issue({ userId: "u1" });
    expect(r.ok).toBe(true);
    expect(sessionsRepo.listActive).toHaveBeenCalled();
    store.available = true;
  });

  it("refresh rotates a valid token", async () => {
    sessionsRepo.findActiveByTokenHash.mockResolvedValue({ user_id: "u1", id: "s1" });
    const r = await svc.refresh("rt");
    expect(r.ok).toBe(true);
    expect(sessionsRepo.rotate).toHaveBeenCalled();
  });

  it("refresh rejects an unknown token", async () => {
    sessionsRepo.findActiveByTokenHash.mockResolvedValue(null);
    const r = await svc.refresh("rt");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(Unauthenticated);
  });

  it("revoke and revokeAll remove from store when available", async () => {
    await svc.revoke("u1", "s1");
    await svc.revokeAll("u1");
    expect(store.remove).toHaveBeenCalledWith("u1", "s1");
    expect(store.removeAll).toHaveBeenCalledWith("u1");
  });
});

describe("DeviceService", () => {
  const devices: any = {
    register: jest.fn(async (i: any) => ({ id: "d1", push_token: i.pushToken })),
    getById: jest.fn(async (id: string) => ({ id })),
    findAnyByHash: jest.fn(async () => ({ id: "d1" })),
    findLive: jest.fn(async () => ({ id: "d1", revoked_at: null })),
    markPinSet: jest.fn(async () => undefined),
    bindRefreshToken: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
  };
  const deviceTokens: any = {
    issueRefreshToken: jest.fn(() => ({ token: "rt", tokenHash: "rth", expiresAt: new Date("2030-01-01T00:00:00Z") })),
  };
  const deviceConfig: any = { numeric: jest.fn(async (_k: string, d: number) => d) };
  const svc = new DeviceService(devices, deviceTokens, deviceConfig);

  beforeEach(() => jest.clearAllMocks());

  it("registers a new device", async () => {
    const r = await svc.register({ userId: "u1", deviceIdHash: "h" });
    expect(r.ok).toBe(true);
    expect((r as any).value.deviceId).toBe("d1");
  });

  it("refuses to register onto a revoked device (B12)", async () => {
    devices.findAnyByHash.mockResolvedValueOnce({ id: "d1", revoked_at: "2026-01-01T00:00:00Z" });
    const r = await svc.register({ userId: "u1", deviceIdHash: "h" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(DeviceRevoked);
  });

  it("records that a local PIN exists without storing it", async () => {
    const r = await svc.setPin("u1", "h");
    expect(r.ok).toBe(true);
    expect(devices.markPinSet).toHaveBeenCalledWith("d1");
  });

  it("reports NotFound when setting a PIN on an unregistered device", async () => {
    devices.findLive.mockResolvedValueOnce(null);
    const r = await svc.setPin("u1", "h");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFound);
  });

  it("binds a device refresh token and caps the offline window", async () => {
    const r = await svc.bindRefresh({ userId: "u1", deviceIdHash: "h" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.refreshToken).toBe("rt");
    expect(deviceConfig.numeric).toHaveBeenCalledWith("auth.device_offline_max_hours", 24);
    expect(devices.bindRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "d1", offlineWindowExpiresAt: r.value.offlineUntil }),
    );
  });

  it("revokes a device by id", async () => {
    const r = await svc.revokeById("d1", "admin");
    expect(r.ok).toBe(true);
    expect(devices.revoke).toHaveBeenCalled();
  });

  it("revokes a device by hash", async () => {
    const r = await svc.revoke("u1", "h", "admin");
    expect(r.ok).toBe(true);
    expect(devices.revoke).toHaveBeenCalled();
  });
});

describe("ConsentService", () => {
  const consents: any = {
    accept: jest.fn(async () => ({ id: "c1" })),
    revoke: jest.fn(async () => 1),
    findAccepted: jest.fn(),
  };
  const svc = new ConsentService(consents);

  beforeEach(() => jest.clearAllMocks());

  it("accepts and returns a consent id", async () => {
    const r = await svc.accept({ userId: "u1", consentType: "GPS_TRACKING_WORKING_HOURS" as any, policyVersion: "v1" });
    expect(r.ok).toBe(true);
    expect((r as any).value.consentId).toBe("c1");
  });

  it("revokes and reports the count", async () => {
    const r = await svc.revoke("u1", "GPS_TRACKING_WORKING_HOURS" as any);
    expect((r as any).value.revoked).toBe(1);
  });

  it("requireFor passes when accepted", async () => {
    consents.findAccepted.mockResolvedValue({ id: "c1" });
    expect((await svc.requireFor("u1", "GPS_TRACKING_WORKING_HOURS" as any)).ok).toBe(true);
  });

  it("requireFor fails when no live consent", async () => {
    consents.findAccepted.mockResolvedValue(null);
    const r = await svc.requireFor("u1", "GPS_TRACKING_WORKING_HOURS" as any);
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(ConsentRequired);
  });

  it("has reflects acceptance", async () => {
    consents.findAccepted.mockResolvedValue({ id: "c1" });
    expect(await svc.has("u1", "GPS_TRACKING_WORKING_HOURS" as any)).toBe(true);
  });
});
