// packages/api/src/middleware/authenticate.ts
// Verifies the HS256 access token and attaches the Principal (02 §1, 03 §1 step 2).
// The token is stateless: roles + the precomputed permission union travel in the claims (02 §5).
// When Redis is healthy the session id is additionally checked against `user:{id}:sessions`, so a
// logout / device revoke / session eviction takes effect immediately (02 §6). A Redis outage
// degrades to the stateless check (R-109) rather than failing the request.

import type { NextFunction, Request, Response } from "express";
import { Unauthenticated } from "@fleet/shared";
import type { SessionStore } from "../config/redis";
import { principalFromClaims, type TokenService } from "../security/tokens";

export interface AuthenticateDeps {
  tokens: TokenService;
  sessions: SessionStore;
  touchSession?: (userId: string, sessionId: string) => Promise<void>;
}

export function authenticate(deps: AuthenticateDeps) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header("authorization") ?? "";
      const [scheme, token] = header.split(" ");
      if (!token || scheme?.toLowerCase() !== "bearer") {
        throw new Unauthenticated("Missing bearer token");
      }

      const claims = deps.tokens.verifyAccessToken(token);
      const principal = principalFromClaims(claims);

      if (principal.sessionId && deps.sessions.available) {
        const live = await deps.sessions.has(principal.userId, principal.sessionId);
        if (!live) throw new Unauthenticated("Session revoked");
      }

      // Idle timeout (A1.6): refresh the session's last_seen_at on every successful auth.
      // Fire-and-forget so auth latency is unaffected by a slow DB round-trip.
      if (principal.sessionId && deps.touchSession) {
        void deps.touchSession(principal.userId, principal.sessionId);
      }

      req.principal = principal;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Narrowing helper for handlers: the route is behind `authenticate`, so this cannot be null. */
export function principalOf(req: Request) {
  if (!req.principal) throw new Unauthenticated();
  return req.principal;
}
