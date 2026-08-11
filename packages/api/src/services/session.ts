// packages/api/src/services/session.ts
// Session issuance + the 10-concurrent-session cap (A1.6 / 02 §6). The cap is enforced with an
// atomic Redis sorted set (user:{id}:sessions); when Redis is down the cap degrades to the DB
// (sessionRepo.listActive) so availability is preserved (R-109). The DB `user_sessions` row is the
// durable record; evicted sessions are revoked there too.

import type { ConfigClient, PermissionCode, Result, RoleCode } from "@fleet/shared";
import { err, ok, Unauthenticated, logger } from "@fleet/shared";
import type { SessionStore } from "../config/redis";
import type { TokenService } from "../security/tokens";
import { hashToken } from "../security/tokens";
import type { SessionRepository } from "../repositories/identity";

export interface ResolvedIdentity {
  email: string;
  phone: string | null;
  /** Tenant membership resolved from app.user_tenants (14_tenancy.sql). Signed into the JWT. */
  tenantId: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  locale: "en" | "sw";
}

export type IdentityResolver = (userId: string) => Promise<ResolvedIdentity>;

export interface IssuedSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  /** Identity mirrored into the JSON body so the mobile client can build its `Principal` without
   * decoding the access token (C5.3: the client parses a trusted response, it does not trust JWTs). */
  email: string | null;
  phone: string | null;
  roles: RoleCode[];
  permissions: PermissionCode[];
  locale: "en" | "sw";
}

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly store: SessionStore,
    private readonly tokens: TokenService,
    private readonly config: ConfigClient,
    private readonly resolveIdentity: IdentityResolver,
  ) {}

  async issue(input: { userId: string; ipAddress?: string | null; userAgent?: string | null; deviceIdHash?: string }): Promise<Result<IssuedSession>> {
    const identity = await this.resolveIdentity(input.userId);
    const maxSessions = await this.config.numeric("auth.max_concurrent_sessions", 10);

    const refresh = this.tokens.issueRefreshToken();
    const session = await this.sessions.create({
      userId: input.userId,
      refreshTokenHash: hashToken(refresh.token),
      expiresAt: refresh.expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    const evicted = await this.evictBeyondCap(input.userId, session.id, refresh.expiresAt, maxSessions);
    for (const id of evicted) {
      await this.sessions.revoke(id, "SESSION_LIMIT_EXCEEDED").catch((e) => logger.error("session.revoke failed", { service_name: "api", id, message: (e as Error).message }, e));
      await this.store.remove(input.userId, id).catch((e) => logger.error("session.store.remove failed", { service_name: "api", userId: input.userId, id, message: (e as Error).message }, e));
    }

    const access = this.tokens.issueAccessToken({
      userId: input.userId,
      email: identity.email,
      tenantId: identity.tenantId,
      roles: identity.roles,
      permissions: identity.permissions,
      sessionId: session.id,
      locale: identity.locale,
      ...(input.deviceIdHash ? { deviceIdHash: input.deviceIdHash } : {}),
    });

    return ok({
      sessionId: session.id,
      userId: input.userId,
      tenantId: identity.tenantId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      email: identity.email,
      phone: identity.phone,
      roles: identity.roles,
      permissions: identity.permissions,
      locale: identity.locale,
    });
  }

  /** Verifies the opaque refresh token, rotates it, and returns a freshly signed access token. */
  async refresh(refreshToken: string): Promise<Result<IssuedSession>> {
    const tokenHash = hashToken(refreshToken);
    const session = await this.sessions.findActiveByTokenHash(tokenHash);
    if (!session) return err(new Unauthenticated("Invalid or expired refresh token"));

    const identity = await this.resolveIdentity(session.user_id);
    const nextRefresh = this.tokens.issueRefreshToken();
    await this.sessions.rotate(session.id, hashToken(nextRefresh.token), nextRefresh.expiresAt);
    if (this.store.available) {
      await this.store
        .add(session.user_id, session.id, nextRefresh.expiresAt, await this.config.numeric("auth.max_concurrent_sessions", 10))
        .catch((e) => logger.error("session.store.add failed", { service_name: "api", userId: session.user_id, message: (e as Error).message }, e));
    }

    const access = this.tokens.issueAccessToken({
      userId: session.user_id,
      email: identity.email,
      tenantId: identity.tenantId,
      roles: identity.roles,
      permissions: identity.permissions,
      sessionId: session.id,
      locale: identity.locale,
    });

    return ok({
      sessionId: session.id,
      userId: session.user_id,
      tenantId: identity.tenantId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: nextRefresh.token,
      refreshTokenExpiresAt: nextRefresh.expiresAt,
      email: identity.email,
      phone: identity.phone,
      roles: identity.roles,
      permissions: identity.permissions,
      locale: identity.locale,
    });
  }

  private async evictBeyondCap(userId: string, sessionId: string, expiresAt: Date, maxSessions: number): Promise<string[]> {
    if (this.store.available) {
      return this.store.add(userId, sessionId, expiresAt, maxSessions);
    }
    const active = await this.sessions.listActive(userId);
    const overflow = active.length - maxSessions;
    return overflow <= 0 ? [] : active.slice(0, overflow).map((s) => s.id);
  }

  async revoke(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, "LOGOUT");
    if (this.store.available) await this.store.remove(userId, sessionId);
  }

  async revokeAll(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId, "LOGOUT_ALL");
    if (this.store.available) await this.store.removeAll(userId);
  }

  /** Idle-timeout touch (A1.6): bump the DB session's last_seen_at on activity. */
  async touch(userId: string, sessionId: string): Promise<void> {
    await this.sessions.touch(sessionId).catch((e) => logger.error("session.touch failed", { service_name: "api", userId, sessionId, message: (e as Error).message }, e));
  }
}
