// packages/api/src/http/routes/auth.ts
// Auth surface (02-auth.md §2–§7). Login is unauthenticated but still idempotent (C5.1); every
// other state-changing route is behind `authenticate` + `idempotency`. MFA enrolment/verify, device
// registration/PIN, and consent all run through executeWrite so their audit + idempotency commit in
// one transaction with the domain mutation (D8).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  isErr,
  ok,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
} from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import { AcceptInviteSchema, ConsentSchema, LoginSchema, MfaEnrollSchema, SetPinSchema, SignupSchema } from "@fleet/shared";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";
import type { IssuedSession } from "../../services/session";

const MfaVerifySchema = z.object({
  mfa_challenge_token: z.string().min(1),
  code: z.string().min(4).max(16),
});
const RefreshSchema = z.object({ refresh_token: z.string().min(1) });
const DeviceRegisterSchema = z.object({
  device_id_hash: z.string().min(16),
  device_label: z.string().max(120).optional(),
  device_model: z.string().max(120).optional(),
  os_version: z.string().max(60).optional(),
  app_version: z.string().max(40).optional(),
  push_token: z.string().max(512).optional(),
});
const DeviceRevokeSchema = z.object({ device_id_hash: z.string().min(16) });

/** Casts a config-sourced permission code string to the generated union without widening errors. */
const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface AuthRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

function sessionBody(s: IssuedSession) {
  return {
    token_type: "Bearer" as const,
    access_token: s.accessToken,
    access_token_expires_at: s.accessTokenExpiresAt.toISOString(),
    refresh_token: s.refreshToken,
    refresh_token_expires_at: s.refreshTokenExpiresAt.toISOString(),
    session_id: s.sessionId,
    // Mirrored identity so the mobile client can build its `Principal` from the trusted response
    // body (it does not decode the access token). Drivers carry `phone`; admins carry `email`.
    user_id: s.userId,
    email: s.email,
    phone: s.phone,
    roles: s.roles,
    permissions: s.permissions,
    locale: s.locale,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  const ip = (req: Request) => req.ip ?? undefined;
  const ua = (req: Request) => req.header("user-agent") ?? undefined;

  // ── Login (unauthenticated, idempotent) ─────────────────────────────────────────────────
  router.post(
    "/login",
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const input = parseBody(LoginSchema, req);
        const svc = makeServices(tx.client, infra);
        const login = await svc.auth.login({
          email: input.email,
          phone: input.phone,
          password: input.password,
          deviceIdHash: input.device_id_hash,
          ipAddress: ip(req),
          userAgent: ua(req),
        });

        if (isErr(login)) {
          tx.audit({
            action: "LOGIN_FAILED",
            entity_table: "app.users",
            actor_user_id: ctx.subject,
            request_id: req.requestId,
            ip_address: ip(req),
            user_agent: ua(req),
            endpoint: req.path,
            http_method: req.method,
            reason: "invalid_credentials",
          });
          return login.error as never;
        }

        const value = login.value;
        if (value.mfaRequired) {
          return ok({
            status: 200,
            body: { mfa_required: true, mfa_challenge_token: value.challengeToken },
          });
        }
        const s = value.session;
        tx.audit({
          action: "LOGIN",
          entity_table: "app.users",
          entity_id: s.userId,
          actor_user_id: s.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return ok({ status: 200, body: sessionBody(s), resourceId: s.sessionId });
      }),
    ),
  );

  // ── MFA verify (challenge → tokens) ─────────────────────────────────────────────────────
  router.post(
    "/mfa/verify",
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx) => {
        const input = parseBody(MfaVerifySchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.mfa.verify(input.mfa_challenge_token, input.code);
        if (isErr(result)) return result.error as never;
        const s = result.value.session;
        tx.audit({
          action: "LOGIN",
          entity_table: "app.users",
          entity_id: s.userId,
          actor_user_id: s.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "mfa",
        });
        return ok({ status: 200, body: sessionBody(s), resourceId: s.sessionId });
      }),
    ),
  );

  // ── Refresh (rotates the opaque refresh token) ─────────────────────────────────────────
  router.post(
    "/refresh",
    asyncHandler((req, res) =>
      writer(req, res, async (tx) => {
        const input = parseBody(RefreshSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.auth.refresh(input.refresh_token);
        if (isErr(result)) return result.error as never;
        return ok({ status: 200, body: sessionBody(result.value), resourceId: result.value.sessionId });
      }),
    ),
  );

  // ── Logout / logout-all ───────────────────────────────────────────────────────────────
  router.post(
    "/logout",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        await svc.auth.logout(principal.userId, principal.sessionId ?? "");
        tx.audit({
          action: "LOGOUT",
          entity_table: "app.user_sessions",
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return ok({ status: 200, body: { logged_out: true } });
      }),
    ),
  );

  router.post(
    "/logout-all",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        await svc.auth.logoutAll(principal.userId);
        tx.audit({
          action: "LOGOUT",
          entity_table: "app.user_sessions",
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "logout_all",
        });
        return ok({ status: 200, body: { logged_out: true } });
      }),
    ),
  );

  // ── Password change (self-service; revokes all sessions on success) ──────────────────
  const ChangePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(8).max(200),
  });
  router.post(
    "/change-password",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ChangePasswordSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.auth.changePassword(
          principal.userId,
          input.current_password,
          input.new_password,
        );
        if (isErr(result)) return result.error as never;
        tx.audit({
          action: "CONFIG_CHANGE",
          entity_table: "app.users",
          entity_id: principal.userId,
          actor_user_id: principal.userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "password_change_logout_all_sessions",
        });
        return ok({ status: 200, body: { changed: true } });
      }),
    ),
  );

  // ── MFA enrolment (self-service) ──────────────────────────────────────────────────────
  router.post(
    "/mfa/enroll",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("MANAGE_OWN_MFA")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        parseBody(MfaEnrollSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.mfa.enroll(principal.userId);
        if (isErr(result)) return result.error as never;
        tx.audit({
          action: "CONFIG_CHANGE",
          entity_table: "app.users",
          entity_id: principal.userId,
          actor_user_id: principal.userId,
          request_id: req.requestId,
          endpoint: req.path,
          http_method: req.method,
          reason: "mfa_enabled",
        });
        return ok({ status: 200, body: { recovery_codes: result.value.recoveryCodes } });
      }),
    ),
  );

  // ── Driver device registration / PIN / refresh / revoke (B12) ─────────────────────────
  router.post(
    "/devices",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(DeviceRegisterSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.device.register({
          userId: principal.userId,
          deviceIdHash: input.device_id_hash,
          deviceLabel: input.device_label ?? null,
          deviceModel: input.device_model ?? null,
          osVersion: input.os_version ?? null,
          appVersion: input.app_version ?? null,
          pushToken: input.push_token ?? null,
        });
        if (isErr(result)) return result.error as never;
        return ok({ status: 200, body: { device_id: result.value.deviceId, push_token: result.value.pushToken } });
      }),
    ),
  );

  router.post(
    "/devices/pin",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        parseBody(SetPinSchema, req); // PIN never leaves the device; the server only flips the flag (B12)
        const svc = makeServices(tx.client, infra);
        const result = await svc.device.setPin(principal.userId, principal.deviceIdHash ?? "");
        if (isErr(result)) return result.error as never;
        return ok({ status: 200, body: { pin_set: true } });
      }),
    ),
  );

  router.post(
    "/devices/refresh",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.device.bindRefresh({
          userId: principal.userId,
          deviceIdHash: principal.deviceIdHash ?? "",
        });
        if (isErr(result)) return result.error as never;
        return ok({
          status: 200,
          body: {
            refresh_token: result.value.refreshToken,
            expires_at: result.value.expiresAt.toISOString(),
            offline_until: result.value.offlineUntil.toISOString(),
          },
        });
      }),
    ),
  );

  router.post(
    "/devices/revoke",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("REVOKE_DEVICE")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(DeviceRevokeSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.device.revoke(input.device_id_hash, input.device_id_hash, principal.userId);
        if (isErr(result)) return result.error as never;
        tx.audit({
          action: "DEVICE_REVOKE",
          entity_table: "app.driver_devices",
          actor_user_id: principal.userId,
          request_id: req.requestId,
          endpoint: req.path,
          http_method: req.method,
        });
        return ok({ status: 200, body: { revoked: true } });
      }),
    ),
  );

  // ── Consent ledger ────────────────────────────────────────────────────────────────────
  router.post(
    "/consent",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ConsentSchema, req);
        const svc = makeServices(tx.client, infra);
        if (input.accepted) {
          const result = await svc.consent.accept({
            userId: principal.userId,
            consentType: input.consent_type,
            policyVersion: input.policy_version,
            ipAddress: ip(req),
            userAgent: ua(req),
            deviceIdHash: principal.deviceIdHash ?? null,
          });
          if (isErr(result)) return result.error as never;
          tx.audit({
            action: "CONFIG_CHANGE",
            entity_table: "app.user_consents",
            entity_id: result.value.consentId,
            actor_user_id: principal.userId,
            request_id: req.requestId,
            endpoint: req.path,
            http_method: req.method,
            reason: `consent:${input.consent_type}`,
          });
          return ok({ status: 200, body: { consent_id: result.value.consentId, accepted: true } });
        }
        const result = await svc.consent.revoke(principal.userId, input.consent_type);
        if (isErr(result)) return result.error as never;
        return ok({ status: 200, body: { accepted: false, revoked: result.value.revoked } });
      }),
    ),
  );

  // ── Self-service company signup: create the tenant + its first ADMIN (unauthenticated) ──────
  //
  // The account created here is a TENANT-SCOPED ADMIN — the company super-admin. It sees the whole
  // company it just created and can invite further ADMIN / FLEET_MANAGER users, but it is NOT a
  // cross-tenant SYSTEM_ADMIN: signup can never reach another company's data.
  //
  // Idempotent like /login (C5.1): a retried Idempotency-Key replays the original session body
  // instead of creating a second company.
  router.post(
    "/signup",
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx) => {
        const input = parseBody(SignupSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.signup(
          {
            companyName: input.company_name,
            email: input.email,
            password: input.password,
            fullName: input.full_name,
          },
          tx.client,
        );
        if (isErr(result)) return result.error as never;

        const { userId, tenantId } = result.value;
        // The session is issued after the membership + role rows exist, so `resolveIdentity` signs
        // the new tenant into the JWT `tid` claim and the very first request is already scoped.
        const session = await svc.session.issue({
          userId,
          ipAddress: ip(req),
          userAgent: ua(req),
        });
        if (isErr(session)) return session.error as never;

        tx.audit({
          action: "TENANT_CREATE",
          entity_table: "app.tenants",
          entity_id: tenantId,
          actor_user_id: userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "self_signup",
        });
        tx.audit({
          action: "MEMBERSHIP_GRANT",
          entity_table: "app.user_roles",
          entity_id: userId,
          actor_user_id: userId,
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
          reason: "signup_admin",
        });

        return ok({
          status: 201,
          body: { ...sessionBody(session.value), tenant_id: tenantId },
          resourceId: tenantId,
        });
      }),
    ),
  );

  // ── Accept an invitation: claim it, set password, become a member of the inviter's tenant ──
  // Registered as the bare segment because this router is already mounted at `${base}/auth`.
  router.post(
    "/accept-invite",
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, async (tx, ctx) => {
        const input = parseBody(AcceptInviteSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.tenancy.acceptInvite(input);
        if (!result.ok) return result.error as never;
        // The inviter's tenant becomes the user's primary tenant immediately, so the issued session
        // is scoped to it without a second round-trip.
        const session = await svc.session.issue({ userId: result.value.userId });
        if (isErr(session)) return session.error as never;
        const identity = session.value;
        tx.audit({
          action: "MEMBERSHIP_GRANT",
          entity_table: "app.users",
          entity_id: result.value.userId,
          actor_user_id: result.value.userId,
          request_id: req.requestId,
          endpoint: req.path,
          http_method: req.method,
        });
        return {
          status: 200,
          body: sessionBody(identity),
        } as never;
      }),
    ),
  );

  return router;
}
