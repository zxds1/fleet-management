// packages/api/src/http/routes/notifications.ts
// Notification inbox routes (C6.4). The list uses a pooled client and emits RFC7807 via
// result.error.toProblem(); the acknowledge runs through executeWrite so the audit entry and the
// idempotency completion commit with the status change (D8).
//
// Both endpoints are scoped to the authenticated principal's user id, which is taken from the
// resolved principal and never from the request, so one user cannot read or acknowledge another's
// notifications.

import { Router, type Request, type Response } from "express";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseQuery } from "../validate";
import { withClient } from "../../db/withClient";
import { CursorQuerySchema } from "../pagination";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

export interface NotificationRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createNotificationRouter(deps: NotificationRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── The caller's inbox (cursor) ──────────────────────────────────────────────────────────
  router.get(
    "/",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("notification:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = (req as Request & { principal?: Principal }).principal as Principal;
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.notification.listForUser(principal.userId, {
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

  // ── Acknowledge one notification ─────────────────────────────────────────────────────────
  router.post(
    "/:id/read",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("notification:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const svc = makeServices(tx.client, infra);
        const result = await svc.notification.markRead(tx, req.params.id!, principal.userId);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.notifications",
          entity_id: result.value.id,
          actor_user_id: principal.userId,
          changed_fields: ["status", "delivered_at"],
          new_value: { status: result.value.status },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 200, body: result.value, resourceId: result.value.id } as never;
      }),
    ),
  );

  return router;
}
