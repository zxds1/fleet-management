// packages/api/src/http/routes/settings.ts
// Admin trigger/threshold settings (C2.4). Mounted at `${base}/admin/settings`, so the paths here
// are relative to that: GET/PUT `/triggers`. The read uses a pooled client and emits RFC7807 via
// result.error.toProblem(); the update runs through executeWrite so the audit entry (which records
// the old and new value — every config change is audited) commits with the change itself (D8).

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

/**
 * `value` is deliberately untyped at the edge: app.system_config stores five value_types and the
 * per-key type is only known once the row is read. SettingsService validates it against the row's
 * declared value_type and min/max bounds, returning 422 rather than letting a DB CHECK 500.
 */
const TriggerUpdateSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())]),
});

export interface SettingsRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Read the trigger allow-list ──────────────────────────────────────────────────────────
  router.get(
    "/triggers",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("config:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.settings.listTriggers();
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

  // ── Update one trigger value ─────────────────────────────────────────────────────────────
  router.put(
    "/triggers",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("config:manage")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(TriggerUpdateSchema, req);
        const svc = makeServices(tx.client, infra);
        // Read the prior value first so the audit entry records what actually changed.
        const before = await svc.settingsRepo.findByKey(input.key);
        const result = await svc.settings.updateTrigger(tx, input, { userId: principal.userId });
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.system_config",
          entity_id: result.value.key,
          actor_user_id: principal.userId,
          changed_fields: ["value"],
          old_value: before ? { value: before.value } : undefined,
          new_value: { value: result.value.value },
          request_id: req.requestId,
          ip_address: ip(req),
          user_agent: ua(req),
          endpoint: req.path,
          http_method: req.method,
        });
        return { status: 200, body: result.value, resourceId: result.value.key } as never;
      }),
    ),
  );

  return router;
}
