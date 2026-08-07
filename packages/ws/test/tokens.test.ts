// packages/ws/test/tokens.test.ts
import jwt from "jsonwebtoken";
import { Unauthenticated } from "@fleet/shared";
import { loadEnv } from "../src/config/env";
import { verifyAccessToken, principalFromClaims } from "../src/security/tokens";

const env = loadEnv();

function sign(overrides: Record<string, unknown> = {}) {
  const claims = {
    sub: "u1",
    email: "admin@example.com",
    roles: ["ADMIN"],
    permissions: ["shift:read_all", "accident:read"],
    sid: "s1",
    locale: "en",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: env.JWT_ISSUER,
    keyid: env.JWT_KID,
  });
}

describe("ws token verification", () => {
  it("verifies a valid access token and builds a Principal", () => {
    const token = sign();
    const claims = verifyAccessToken(token, env);
    expect(claims.sub).toBe("u1");
    const principal = principalFromClaims(claims);
    expect(principal.userId).toBe("u1");
    expect(principal.sessionId).toBe("s1");
    expect(principal.permissions.has("shift:read_all")).toBe(true);
    expect(principal.permissions.has("accident:read")).toBe(true);
  });

  it("rejects a token signed with the wrong secret", () => {
    const bad = jwt.sign({ sub: "u1" }, "not-the-secret", {
      algorithm: "HS256",
      issuer: env.JWT_ISSUER,
    });
    expect(() => verifyAccessToken(bad, env)).toThrow(Unauthenticated);
  });

  it("rejects an expired token", () => {
    const expired = sign({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(() => verifyAccessToken(expired, env)).toThrow(Unauthenticated);
  });

  it("passes through the previous key during rotation", () => {
    const envWithPrev = { ...env, JWT_SECRET_PREVIOUS: "previous-secret", JWT_KID_PREVIOUS: "k0" };
    const token = jwt.sign(
      { sub: "u2", email: "x@y.z", roles: [], permissions: [], sid: "s2", locale: "en" },
      "previous-secret",
      { algorithm: "HS256", issuer: env.JWT_ISSUER, keyid: "k0" },
    );
    expect(verifyAccessToken(token, envWithPrev).sub).toBe("u2");
  });
});
