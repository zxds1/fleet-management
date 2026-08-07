// packages/api/src/http/routes/media.ts
// Media route (03 §2.7, D5). `POST /media/upload-url` mints a 60-second presigned PUT (C5.1 is NOT
// required here — the openapi contract omits idempotencyKey for this endpoint) and pre-inserts the
// `media_objects` row inside executeWrite so audit commits with the mutation (D8). The binary is
// uploaded by the client straight to S3; the API never buffers bytes. Driver/media owner is the
// authenticated principal.

import { Router, type Request, type Response } from "express";
import { type IdempotencyService, type PoolLike, type Principal } from "@fleet/shared";
import { MediaUploadSchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

export interface MediaRouterDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  releaseClaim: (subject: string, key: string) => Promise<void>;
  infra: Infra;
}

export function createMediaRouter(deps: MediaRouterDeps): Router {
  const router = Router();
  const { pool, idempotency: idem, releaseClaim, infra } = deps;
  const writer = (req: Request, res: Response, fn: Parameters<typeof executeWrite>[3]) =>
    executeWrite(req, res, { pool, idempotency: idem, releaseClaim }, fn);

  router.post(
    "/upload-url",
    authenticate({ tokens: infra.tokens, sessions: infra.store }),
    asyncHandler((req, res) =>
      writer(req, res, async (tx, ctx) => {
        const principal = ctx.principal as Principal;
        const input = parseBody(MediaUploadSchema, req);
        const svc = makeServices(tx.client, infra);
        const result = await svc.media.uploadUrl(tx, {
          userId: principal.userId,
          email: principal.email,
          roles: principal.roles,
        }, input);
        if (result.ok) return { status: 201, body: result.value, resourceId: result.value.mediaObjectId } as never;
        return result.error as never;
      }),
    ),
  );

  return router;
}
