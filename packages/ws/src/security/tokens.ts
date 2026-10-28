// packages/ws/src/security/tokens.ts
// Stateless HS256 access-token verification for the gateway (07 §2). This is the read-side mirror of
// @fleet/api's TokenService signer: it only VERIFIES (it never issues tokens). Keeping the verifier
// here — rather than in @fleet/shared, which stays dependency-light — avoids pulling jsonwebtoken
// into the shared kernel used by mobile/admin. The signing key + issuer match the api (A3.7).

import jwt, { type JwtPayload } from "jsonwebtoken";
import { Unauthenticated, BOOTSTRAP_TENANT_ID, type PermissionCode, type Principal, type RoleCode } from "@fleet/shared";
import type { Env } from "../config/env";

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  email: string;
  /**
   * Owning tenant (14_tenancy.sql). Signed into the token so the tenant can never be spoofed by a
   * request field. A token minted before tenancy shipped carries none, and then the caller belongs
   * to the bootstrap tenant — exactly where its rows were back-filled.
   */
  tid?: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  sid: string;
  locale: "en" | "sw";
  dev?: string; // device_id_hash (driver PIN path, B12)
  exp?: number;
}

/** Verifies the access token against the current/previous key (24 h rotation overlap, 02 §1). */
export function verifyAccessToken(token: string, env: Env): AccessTokenClaims {
  const secrets = [
    { kid: env.JWT_KID, secret: env.JWT_SECRET },
    ...(env.JWT_SECRET_PREVIOUS
      ? [{ kid: env.JWT_KID_PREVIOUS, secret: env.JWT_SECRET_PREVIOUS }]
      : []),
  ];
  const decodedHeader = jwt.decode(token, { complete: true })?.header;
  const candidates = decodedHeader?.kid ? secrets.filter((s) => s.kid === decodedHeader.kid) : secrets;
  const tried = candidates.length > 0 ? candidates : secrets;

  let lastError: unknown;
  for (const candidate of tried) {
    try {
      const claims = jwt.verify(token, candidate.secret, {
        algorithms: ["HS256"],
        issuer: env.JWT_ISSUER,
      }) as AccessTokenClaims & { scope?: string };
      if (claims.scope === "mfa" || !claims.sid) {
        throw new Unauthenticated("Invalid access token");
      }
      if (!Array.isArray(claims.roles) || !Array.isArray(claims.permissions)) {
        throw new Unauthenticated("Invalid access token");
      }
      return claims as AccessTokenClaims;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Unauthenticated(
    lastError instanceof jwt.TokenExpiredError ? "Access token expired" : "Invalid access token",
  );
}

/** Principal built from verified claims (02 §1). */
export function principalFromClaims(claims: AccessTokenClaims): Principal {
  return {
    userId: claims.sub,
    email: claims.email,
    roles: claims.roles ?? [],
    permissions: new Set<PermissionCode>(claims.permissions ?? []),
    sessionId: claims.sid,
    locale: claims.locale ?? "en",
    // Same fallback as the API verifier: a pre-tenancy token belongs to the bootstrap tenant.
    // An empty tenant id would name a scope that matches nothing.
    tenantId: claims.tid ?? BOOTSTRAP_TENANT_ID,
    ...(claims.dev ? { deviceIdHash: claims.dev } : {}),
  };
}
