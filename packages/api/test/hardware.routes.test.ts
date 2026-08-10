// packages/api/test/hardware.routes.test.ts
// Unit tests for the hardware provisioning pure logic: tracker status derivation (getStatus) and the
// SMS command builder (buildSmsCommand). The /pair idempotent-resend and /pending scan-window
// behaviour live in the route and are covered by integration checks; here we lock the decision logic.
import { buildSmsCommand, getStatus } from "../src/http/routes/hardware";

describe("buildSmsCommand", () => {
  it("returns no command for Teltonika (USB-configured, not SMS)", () => {
    const { smsCommand, message } = buildSmsCommand("TELTONIKA", "1.2.3.4", "5013");
    expect(smsCommand).toBe("");
    expect(message).toContain("Configurator");
  });

  it("uses SERVER, form for H02-family brands", () => {
    const { smsCommand } = buildSmsCommand("GENERIC_H02", "1.2.3.4", "5013");
    expect(smsCommand).toBe("SERVER,1,1.2.3.4,5013,0#");
  });

  it("uses SET, form for Concox/Jimi brands", () => {
    const { smsCommand } = buildSmsCommand("JIMI_CONCOX", "1.2.3.4", "5013");
    expect(smsCommand).toBe("SET,1,1.2.3.4,5013,0#");
  });
});

describe("getStatus", () => {
  const now = new Date("2026-08-09T12:00:00Z");
  it("is PENDING when never seen", () => {
    expect(getStatus(null, now)).toBe("PENDING");
  });
  it("is ONLINE within 5 minutes", () => {
    expect(getStatus(new Date(now.getTime() - 60_000), now)).toBe("ONLINE");
  });
  it("is OFFLINE within 24 hours", () => {
    expect(getStatus(new Date(now.getTime() - 60 * 60 * 1000), now)).toBe("OFFLINE");
  });
  it("is LOST after 24 hours", () => {
    expect(getStatus(new Date(now.getTime() - 25 * 60 * 60 * 1000), now)).toBe("LOST");
  });
});