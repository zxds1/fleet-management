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
import { ConsentSchema, LoginSchema, MfaEnrollSchema } from "@fleet/shared";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";
import type { IssuedSession } from "../../services/session";

const MfaVerifySchema = z.object({
  mfa_challenge_token: z.string().min(1),
  code: z.string().min(4).max(16),
});
const RefreshSchema = z.object({ refresh_token: z.string().min(1) });
const MfaConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
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

  // ── Admin self-signup (public, idempotent) ──────────────────────────────────────────────
  const AdminSignupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    full_name: z.string().min(1).max(200),
    phone: z.string().max(40).optional(),
  });
  router.post(
    "/admin-signup",
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx) => {
        const input = parseBody(AdminSignupSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.auth.signupAdmin({
          email: input.email,
          password: input.password,
          fullName: input.full_name,
          phone: input.phone ?? null,
        });
        if (isErr(result)) return result.error as never;
        const value = result.value;
        return ok({
          status: 201,
          body: { user_id: value.userId, email: value.email, role: value.role },
        });
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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

  // ── MFA enrolment (self-service) ──────────────────────────────────────────────────────
  router.post(
    "/mfa/enroll",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("MANAGE_OWN_MFA")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        parseBody(MfaEnrollSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.mfa.enroll(principal.userId);
        if (isErr(result)) return result.error as never;
        return ok({
          status: 200,
          body: { secret: result.value.secret, otpauth_uri: result.value.otpauthUri },
        });
      }),
    ),
  );

  router.post(
    "/mfa/confirm",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("MANAGE_OWN_MFA")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(MfaConfirmSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.mfa.confirm(principal.userId, input.code);
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    "/devices/revoke",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
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

  return router;
}
