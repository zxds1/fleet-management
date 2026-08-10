// packages/api/src/security/tokens.ts
// Self-issued JWT, HS256 (A3.7). The access token is stateless and carries the precomputed
// permission union (02 §1/§5) so request-time authz needs no DB lookup. The verifier accepts the
// current and previous key (kid header) for a 24 h rotation overlap.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { Unauthenticated, BOOTSTRAP_TENANT_ID, type Principal, type PermissionCode, type RoleCode } from "@fleet/shared";
import type { Env } from "../config/env";

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  /** Owning tenant (14_tenancy.sql). Signed into the token so the tenant can never be spoofed
   *  by a request field; falls back to the bootstrap tenant for tokens minted pre-tenancy. */
  tid: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  sid: string;
  locale: "en" | "sw";
  dev?: string; // device_id_hash (driver PIN path, B12)
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface IssuedRefreshToken {
  /** Returned to the client, never stored. */
  token: string;
  /** SHA-256 of the token — this is what app.user_sessions / driver_devices persist. */
  tokenHash: string;
  expiresAt: Date;
}

export class TokenService {
  constructor(private readonly env: Env) {}

  issueAccessToken(input: {
    userId: string;
    email: string;
    tenantId: string;
    roles: RoleCode[];
    permissions: PermissionCode[];
    sessionId: string;
    locale: "en" | "sw";
    deviceIdHash?: string;
  }): IssuedAccessToken {
    const expiresInSeconds = this.env.ACCESS_TOKEN_TTL_SECONDS;
    const payload: Omit<AccessTokenClaims, "iat" | "exp" | "iss"> = {
      sub: input.userId,
      email: input.email,
      tid: input.tenantId,
      roles: input.roles,
      permissions: input.permissions,
      sid: input.sessionId,
      locale: input.locale,
      ...(input.deviceIdHash ? { dev: input.deviceIdHash } : {}),
    };
    const token = jwt.sign(payload, this.env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: expiresInSeconds,
      issuer: this.env.JWT_ISSUER,
      keyid: this.env.JWT_KID,
    });
    return { token, expiresInSeconds, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  /** Opaque refresh token (02 §1). Only its SHA-256 hash is persisted. */
  issueRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(48).toString("base64url");
    return {
      token,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const secrets = [
      { kid: this.env.JWT_KID, secret: this.env.JWT_SECRET },
      ...(this.env.JWT_SECRET_PREVIOUS
        ? [{ kid: this.env.JWT_KID_PREVIOUS, secret: this.env.JWT_SECRET_PREVIOUS }]
        : []),
    ];
    const decodedHeader = jwt.decode(token, { complete: true })?.header;
    const candidates = decodedHeader?.kid
      ? secrets.filter((s) => s.kid === decodedHeader.kid)
      : secrets;
    const tried = candidates.length > 0 ? candidates : secrets;

    let lastError: unknown;
    for (const candidate of tried) {
      try {
        return jwt.verify(token, candidate.secret, {
          algorithms: ["HS256"],
          issuer: this.env.JWT_ISSUER,
        }) as AccessTokenClaims;
      } catch (e) {
        lastError = e;
      }
    }
    throw new Unauthenticated(
      lastError instanceof jwt.TokenExpiredError ? "Access token expired" : "Invalid access token",
    );
  }

  /** Short-lived challenge token issued after password verification when MFA is enforced. */
  issueMfaChallenge(input: { userId: string; email: string }): string {
    return jwt.sign(
      { sub: input.userId, email: input.email, scope: "mfa" },
      this.env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: this.env.MFA_CHALLENGE_TTL_SECONDS,
        issuer: this.env.JWT_ISSUER,
        keyid: this.env.JWT_KID,
      },
    );
  }

  verifyMfaChallenge(token: string): { userId: string; email: string } {
    try {
      const decoded = jwt.verify(token, this.env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: this.env.JWT_ISSUER,
      }) as JwtPayload & { sub: string; email: string; scope?: string };
      if (decoded.scope !== "mfa") throw new Unauthenticated("Invalid MFA challenge");
      return { userId: decoded.sub, email: decoded.email };
    } catch (e) {
      if (e instanceof Unauthenticated) throw e;
      throw new Unauthenticated("MFA challenge expired or invalid");
    }
  }
}

/** Principal built from verified claims (02 §1, 14_tenancy.sql). */
export function principalFromClaims(claims: AccessTokenClaims): Principal {
  return {
    userId: claims.sub,
    // A token minted before tenancy shipped carries no `tid`; it belongs to the bootstrap tenant,
    // which is exactly what its rows were back-filled to.
    tenantId: claims.tid ?? BOOTSTRAP_TENANT_ID,
    email: claims.email,
    roles: claims.roles ?? [],
    permissions: new Set<PermissionCode>(claims.permissions ?? []),
    sessionId: claims.sid,
    locale: claims.locale ?? "en",
    ...(claims.dev ? { deviceIdHash: claims.dev } : {}),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison for opaque secrets (recovery codes, token hashes). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
