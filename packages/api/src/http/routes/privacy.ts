// packages/api/src/http/routes/privacy.ts
// Data Subject Access Request (DSAR) routes (15_privacy_requests.sql).
// GDPR Articles 15 (access), 17 (erasure), 20 (portability); mirrored by Kenya DPA 2019.
//
// RBAC:
//   privacy:request_own            — DRIVER (self-service export + deletion request)
//   privacy:view_requests_tenant   — ADMIN / FLEET_MANAGER (view tenant-wide requests)
//
// Export flow:  POST /export-request  →  202 + outbox event (worker generates file)
//               GET  /export-request  →  list the caller's own requests
//               GET  /export-request/:id/download → presigned URL for a READY export
// Deletion flow: POST /deletion-request →  202 + outbox event (worker soft-deletes)
//
// State-changing routes carry Idempotency-Key (C5.1) and run through executeWrite
// so the audit entry + outbox event commit with the insert (D8). Reads use a pooled client.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  Forbidden,
  NotFound,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
} from "@fleet/shared";
import { ExportRequestSchema, DeletionRequestSchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { CursorQuerySchema } from "../pagination";
import { withTenantClient, tenantContextOf } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

const StatusQuerySchema = CursorQuerySchema.extend({
  status: z
    .enum(["PENDING", "PROCESSING", "READY", "DOWNLOADED", "COMPLETED", "FAILED"])
    .array()
    .optional(),
});

export interface PrivacyRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createPrivacyRouter(deps: PrivacyRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── POST /export-request ─────────────────────────────────────────────────────
  // Driver submits an export request → 202 Accepted + outbox event.
  router.post(
    "/export-request",
    authenticate({ tokens: infra.tokens, sessions: infra.store, touchSession: infra.touchSession }),
    requirePermission(asPerm("privacy:request_own")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(ExportRequestSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden("Only a driver can submit a DSAR export request") as never;

        const result = await svc.privacy.createExportRequest(tx, principal.userId, principal.tenantId, input.notes ?? null);
        if (!result.ok) return result.error as never;

        tx.audit({
          action: "EXPORT",
          entity_table: "app.privacy_requests",
          entity_id: result.value.request_id,
          actor_user_id: principal.userId,
          actor_email: principal.email,
          actor_role_codes: principal.roles,
          new_value: { request_type: "EXPORT", notes: input.notes ?? null },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });

        return {
          status: 202,
          body: { request_id: result.value.request_id, status: result.value.status },
          resourceId: result.value.request_id,
        } as never;
      }),
    ),
  );

  // ── POST /deletion-request ───────────────────────────────────────────────────
  // Driver requests account deletion → 202 Accepted + outbox event.
  router.post(
    "/deletion-request",
    authenticate({ tokens: infra.tokens, sessions: infra.store, touchSession: infra.touchSession }),
    requirePermission(asPerm("privacy:request_own")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(DeletionRequestSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden("Only a driver can submit a DSAR deletion request") as never;

        const result = await svc.privacy.createDeletionRequest(tx, principal.userId, principal.tenantId, input.reason);
        if (!result.ok) return result.error as never;

        tx.audit({
          action: "DELETE",
          entity_table: "app.privacy_requests",
          entity_id: result.value.request_id,
          actor_user_id: principal.userId,
          actor_email: principal.email,
          actor_role_codes: principal.roles,
          new_value: { request_type: "DELETION", reason: input.reason },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });

        return {
          status: 202,
          body: { request_id: result.value.request_id, status: result.value.status },
          resourceId: result.value.request_id,
        } as never;
      }),
    ),
  );

  // ── GET /export-request ──────────────────────────────────────────────────────
  // List the caller's own export requests (and deletion requests).
  router.get(
    "/export-request",
    authenticate({ tokens: infra.tokens, sessions: infra.store, touchSession: infra.touchSession }),
    requirePermission(asPerm("privacy:request_own")),
    asyncHandler((req, res) =>
      withTenantClient(pool, tenantContextOf(req.principal!), async (client) => {
        const principal = (req as { principal?: Principal }).principal as Principal;
        const query = parseQuery(StatusQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.privacy.listOwn(client, principal.userId, {
          limit: query.limit,
          cursor: query.cursor ?? null,
        });
        if (!result.ok) {
          res
            .status(result.error.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...result.error.toProblem(), instance: req.requestId });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  // ── GET /export-request/:id/download ──────────────────────────────────────────
  // For a READY export, return a presigned URL and mark the row DOWNLOADED.
  // This is a state-changing GET (marks DOWNLOADED), so it runs through executeWrite
  // with tenant context bound to the principal.
  router.get(
    "/export-request/:id/download",
    authenticate({ tokens: infra.tokens, sessions: infra.store, touchSession: infra.touchSession }),
    requirePermission(asPerm("privacy:request_own")),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.privacy.getDownloadUrl(
          tx.client,
          req.params.id!,
          principal.userId,
        );
        if (!result.ok) return result.error as never;
        return {
          status: 200,
          body: result.value,
        } as never;
      }),
    ),
  );

  // ── GET /requests (tenant-wide, admin/manager) ────────────────────────────────
  // Admins and managers can view all DSAR requests for their tenant.
  router.get(
    "/requests",
    authenticate({ tokens: infra.tokens, sessions: infra.store, touchSession: infra.touchSession }),
    requirePermission(asPerm("privacy:view_requests_tenant")),
    asyncHandler((req, res) =>
      withTenantClient(pool, tenantContextOf(req.principal!), async (client) => {
        const query = parseQuery(StatusQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.privacy.listForTenant(client, {
          limit: query.limit,
          cursor: query.cursor ?? null,
          statuses: query.status,
        });
        if (!result.ok) {
          res
            .status(result.error.httpStatus)
            .type(PROBLEM_CONTENT_TYPE)
            .json({ ...result.error.toProblem(), instance: req.requestId });
          return;
        }
        res.status(200).json(result.value);
      }),
    ),
  );

  return router;
}
