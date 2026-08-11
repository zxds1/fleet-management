// packages/mobile/src/core/__tests__/security.test.ts
import { Security, defaultSecurityConfig, type DeviceIntegrityPort, type PinnedEndpoint } from "../security";

function makeSecurity(integrity: Partial<DeviceIntegrityPort>, pins: PinnedEndpoint[] = []) {
  return new Security({
    integrity: { isRooted: () => false, isTampered: () => false, ...integrity },
    config: defaultSecurityConfig(pins),
  });
}

describe("Security — device integrity (S-4)", () => {
  it("allows a clean device to run and use the offline PIN", async () => {
    const s = makeSecurity({});
    const report = await s.checkIntegrity();
    expect(report).toEqual({ rooted: false, tampered: false, blockReason: null, allowOfflinePin: true });
    expect(await s.shouldRefuseRun()).toBe(false);
  });

  it("refuses to run on a rooted device and withholds the offline PIN", async () => {
    const s = makeSecurity({ isRooted: () => true });
    const report = await s.checkIntegrity();
    expect(report.rooted).toBe(true);
    expect(report.blockReason).toBe("rooted");
    expect(report.allowOfflinePin).toBe(false);
    expect(await s.shouldRefuseRun()).toBe(true);
  });

  it("refuses to run on a tampered (repackaged) device and withholds the offline PIN", async () => {
    const s = makeSecurity({ isTampered: () => true });
    const report = await s.checkIntegrity();
    expect(report.tampered).toBe(true);
    expect(report.blockReason).toBe("tampered");
    expect(report.allowOfflinePin).toBe(false);
    expect(await s.shouldRefuseRun()).toBe(true);
  });

  it("does not run when the integrity port returns a promise", async () => {
    const s = makeSecurity({ isRooted: async () => true });
    expect(await s.shouldRefuseRun()).toBe(true);
  });
});

describe("Security — certificate pinning (S-4)", () => {
  const pins: PinnedEndpoint[] = [
    { host: "api.fleet.internal", pins: ["pin-aaaaa", "pin-bbbbb"] },
  ];

  it("verifies a matching pin", () => {
    expect(makeSecurity({}, pins).verifyPin("api.fleet.internal", "pin-bbbbb")).toBe(true);
  });

  it("rejects a mismatched pin", () => {
    expect(makeSecurity({}, pins).verifyPin("api.fleet.internal", "pin-evil")).toBe(false);
  });

  it("rejects unknown hosts (no pin configured)", () => {
    expect(makeSecurity({}, pins).verifyPin("evil.example", "pin-aaaaa")).toBe(false);
  });
});

describe("Security — deep-link validation (S-4)", () => {
  const s = makeSecurity({});

  it("accepts an allow-listed deep link", () => {
    expect(s.validateDeepLink("fleet://link.fleet.internal/accident/123?ack=1")).toEqual({
      scheme: "fleet",
      host: "link.fleet.internal",
      path: "/accident/123",
      query: "?ack=1",
    });
  });

  it("rejects an unknown scheme", () => {
    expect(s.validateDeepLink("http://evil.com/x")).toBeNull();
  });

  it("rejects an unknown host for the https scheme", () => {
    expect(s.validateDeepLink("https://evil.com/x")).toBeNull();
  });

  it("rejects a malformed link without throwing", () => {
    expect(s.validateDeepLink("not a url :::")).toBeNull();
  });
});
