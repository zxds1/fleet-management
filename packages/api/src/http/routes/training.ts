// packages/api/src/http/routes/training.ts
// Training / LMS routes (Phase 3, 12_training.sql). Reads use a pooled client and emit RFC7807 via
// result.error.toProblem(); the completion write runs through executeWrite so the audit entry, the
// outbox event and the idempotency completion commit in one transaction (D8).
//
// Route-order rule: `/lessons` and `/roster` are literal paths registered before `/lessons/:id`, and
// `/lessons/:id/complete` is a distinct method+path so it cannot be shadowed.
//
// The completing driver is resolved from the authenticated principal, never from the body: a driver
// can only ever complete a lesson as themselves.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  Forbidden,
  type IdempotencyService,
  type PermissionCode,
  type PoolLike,
  type Principal,
} from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler, PROBLEM_CONTENT_TYPE } from "../problem";
import { executeWrite } from "../write";
import { parseBody, parseQuery } from "../validate";
import { withClient } from "../../db/withClient";
import { CursorQuerySchema } from "../pagination";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;
const ip = (req: Request) => req.ip ?? undefined;
const ua = (req: Request) => req.header("user-agent") ?? undefined;

const LessonCompleteSchema = z.object({
  quiz_score: z.number().int().min(0).max(100).optional(),
});

export interface TrainingRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createTrainingRouter(deps: TrainingRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Lesson catalogue (cursor) ────────────────────────────────────────────────────────────
  router.get(
    "/lessons",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("training:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.training.listLessons({ limit: query.limit, cursor: query.cursor ?? null });
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

  // ── Manager roster ───────────────────────────────────────────────────────────────────────
  // Registered before `/lessons/:id` is irrelevant here (different prefix), but kept above the
  // parameterised lesson route for readability.
  router.get(
    "/roster",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("training:review")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const query = parseQuery(CursorQuerySchema, req);
        const svc = makeServices(client, infra);
        const result = await svc.training.roster({ limit: query.limit, cursor: query.cursor ?? null });
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

  // ── Complete a lesson (current driver) ───────────────────────────────────────────────────
  router.post(
    "/lessons/:id/complete",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("training:complete")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(LessonCompleteSchema, req);
        const svc = makeServices(tx.client, infra);
        // Only a driver profile can hold an enrolment; an admin without one cannot self-complete.
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden("Only a driver can complete a training lesson") as never;
        const result = await svc.training.completeLesson(tx, driver.id, req.params.id!, input);
        if (!result.ok) return result.error as never;
        tx.audit({
          action: "UPDATE",
          entity_table: "app.training_enrollments",
          entity_id: result.value.id,
          actor_user_id: principal.userId,
          new_value: { lesson_id: req.params.id, status: result.value.status, quiz_score: input.quiz_score ?? null },
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

  // ── Single lesson ────────────────────────────────────────────────────────────────────────
  // MUST stay after `/lessons` and `/lessons/:id/complete`.
  router.get(
    "/lessons/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    requirePermission(asPerm("training:read")),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const svc = makeServices(client, infra);
        const result = await svc.training.getLesson(req.params.id!);
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
