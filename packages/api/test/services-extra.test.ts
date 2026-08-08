// packages/api/test/services-extra.test.ts
// Closes the service-coverage gap (P1#3): unit tests for the auth-support services that previously
// had no tests — MFA, sessions (incl. the 10-session cap + Redis degradation), driver devices, and
// the consent ledger. All collaborators are faked; totp is mocked so verify() is deterministic.
import { ok, err, Unauthenticated, ValidationError, DeviceRevoked, NotFound, ConsentRequired } from "@fleet/shared";
import { MfaService } from "../src/services/mfa";
import { SessionService } from "../src/services/session";
import { DeviceService } from "../src/services/device";
import { ConsentService } from "../src/services/consent";
jest.mock("../src/security/totp", () => ({
  totp: { generateSecret: jest.fn(() => "SECRET"), provisioningUri: jest.fn(() => "uri"), verify: jest.fn(() => true) },
  generateSecret: jest.fn(() => "SECRET"),
  provisioningUri: jest.fn(() => "uri"),
  verify: jest.fn(() => true),
}));
const totpMock = require("../src/security/totp").totp as { verify: jest.Mock };

function fakeSecretBox(): any {
  return { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, "") };
}

describe("MfaService", () => {
  const users: any = {
    getById: jest.fn(),
    stageMfaSecret: jest.fn(async () => undefined),
    activateMfa: jest.fn(async () => undefined),
  };
  const recovery: any = { replaceAll: jest.fn(async () => undefined), consume: jest.fn(async () => false) };
  const tokens: any = { verifyMfaChallenge: jest.fn(() => ({ userId: "u1" })) };
  const sessions: any = {
    issue: jest.fn(async () => ok({ sessionId: "s1", userId: "u1", accessToken: "a", accessTokenExpiresAt: new Date(), refreshToken: "r", refreshTokenExpiresAt: new Date() })),
  };
  const svc = new MfaService(users, recovery, fakeSecretBox(), tokens, sessions);

  beforeEach(() => jest.clearAllMocks());

  it("enrols and stages an encrypted secret", async () => {
    users.getById.mockResolvedValue({ email: "a@b.c", mfa_secret_encrypted: null });
    const r = await svc.enroll("u1");
    expect(r.ok).toBe(true);
    expect(users.stageMfaSecret).toHaveBeenCalled();
    expect((r as any).value.otpauthUri).toBe("uri");
  });

  it("enrol fails for unknown user", async () => {
    users.getById.mockResolvedValue(null);
    expect((await svc.enroll("x")).ok).toBe(false);
  });

  it("confirms with a valid code and issues recovery codes", async () => {
    users.getById.mockResolvedValue({ email: "a@b.c", mfa_secret_encrypted: "enc:SECRET" });
    totpMock.verify.mockReturnValue(true);
    const r = await svc.confirm("u1", "123456");
    expect(r.ok).toBe(true);
    expect(recovery.replaceAll).toHaveBeenCalled();
    expect(users.activateMfa).toHaveBeenCalled();
    expect((r as any).value.recoveryCodes).toHaveLength(10);
  });

  it("confirm rejects when enrolment not started", async () => {
    users.getById.mockResolvedValue({ email: "a@b.c", mfa_secret_encrypted: null });
    const r = await svc.confirm("u1", "123456");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(ValidationError);
  });

  it("verify issues a session on a valid TOTP", async () => {
    users.getById.mockResolvedValue({ mfa_enabled: true, mfa_secret_encrypted: "enc:SECRET" });
    totpMock.verify.mockReturnValue(true);
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(true);
    expect(sessions.issue).toHaveBeenCalled();
  });

  it("verify rejects when MFA is not configured", async () => {
    users.getById.mockResolvedValue({ mfa_enabled: false, mfa_secret_encrypted: null });
    const r = await svc.verify("chal", "123456");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBeInstanceOf(Unauthenticated);
  });

  it("verify consumes a recovery code", async () => {
    users.getById.mockResolvedValue({ mfa_enabled: true, mfa_secret_encrypted: "enc:SECRET" });
    totpMock.verify.mockReturnValue(false);
    recovery.consume.mockResolvedValue(true);
    const r = await svc.verify("chal", "RECOVERY");
    expect(r.ok).toBe(true);
  });

  it("verify rejects an invalid code", async () => {
    users.getById.mockResolvedValue({ mfa_enabled: true, mfa_secret_encrypted: "enc:SECRET" });
    totpMock.verify.mockReturnValue(false);
    recovery.consume.mockResolvedValue(false);
    const r = await svc.verify("chal", "bad");
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
  const resolveIdentity = jest.fn(async () => ({ email: "a@b.c", roles: ["DRIVER"] as any, permissions: [], locale: "en" as const }));
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
    revoke: jest.fn(async () => undefined),
  };
  const svc = new DeviceService(devices);

  beforeEach(() => jest.clearAllMocks());

  it("registers a new device", async () => {
    const r = await svc.register({ userId: "u1", deviceIdHash: "h" });
    expect(r.ok).toBe(true);
    expect((r as any).value.deviceId).toBe("d1");
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
