// packages/api/src/http/routes/trailer.ts
// Trailer routes (03 §2.6, 1.3). The single write carries Idempotency-Key (C5.1) and runs through
// executeWrite so audit + outbox commit with the mutation (D8). Driver id is resolved from the
// Principal via drivers.user_id.

import { Router, type Request, type Response } from "express";
import { Forbidden, type IdempotencyService, type PermissionCode, type PoolLike, type Principal } from "@fleet/shared";
import { TrailerSwapSchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { idempotency } from "../../middleware/idempotency";
import { requirePermission } from "../../middleware/requirePermission";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

const asPerm = (code: string): PermissionCode => code as PermissionCode;

export interface TrailerRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createTrailerRouter(deps: TrailerRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  // ── Hook / drop a trailer (1.3) ──────────────────────────────────────────────────────────
  router.post(
    "/swap",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    requirePermission(asPerm("trailer:swap")),
    idempotency({ idempotency: idem }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(TrailerSwapSchema, req);
        const svc = makeServices(tx.client, infra);
        const driver = await svc.drivers.findByUserId(principal.userId);
        if (!driver) return new Forbidden() as never;
        const result = await svc.trailer.swap(tx, driver.id, input, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        });
        if (result.ok) {
          return {
            status: 201,
            body: {
              trailer_assignment_id: result.value.trailerAssignmentId,
              dropped_trailer_id: result.value.droppedTrailerId,
              created_trailer_id: result.value.createdTrailerId,
            },
            resourceId: result.value.trailerAssignmentId ?? undefined,
          } as never;
        }
        return result.error as never;
      }),
    ),
  );

  return router;
}
