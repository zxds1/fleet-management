// packages/api/src/http/routes/media.ts
// Media route (03 §2.7, D5). `POST /media/upload-url` mints a 60-second presigned PUT (C5.1 is NOT
// required here — the openapi contract omits idempotencyKey for this endpoint) and pre-inserts the
// `media_objects` row inside executeWrite so audit commits with the mutation (D8). The binary is
// uploaded by the client straight to S3; the API never buffers bytes. Driver/media owner is the
// authenticated principal.

import { Router, type Request, type Response } from "express";
import { NotFound, type IdempotencyService, type PoolLike, type Principal } from "@fleet/shared";
import { MediaUploadSchema } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { asyncHandler } from "../problem";
import { executeWrite } from "../write";
import { parseBody } from "../validate";
import type { Infra } from "../../app/compose";
import { withClient, withTenantClient, tenantContextOf } from "../../db/withClient";
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
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
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


  // ── Fetch a stored media object (F7) ────────────────────────────────────────────────────────
  // Returns a short-lived presigned GET so the client can render the binary without holding S3
  // credentials. Access is tenant-scoped: the row must belong to the caller's tenant (checked both
  // by RLS via withTenantClient and by the explicit tenant_id filter), so a caller cannot mint a
  // presigned URL for another company's receipt/photo.
  router.get(
    "/:id",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    asyncHandler(async (req, res) => {
      const principal = (req as { principal?: Principal }).principal as Principal;
      const id = req.params.id;
      const obj = await withTenantClient(pool, tenantContextOf(principal), (client) =>
        client.query<{ bucket: string; object_key: string; content_type: string | null }>(
          `SELECT bucket, object_key, content_type FROM app.media_objects
            WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [id, principal.tenantId],
        ).then((r) => r.rows[0] ?? null),
      );
      if (!obj) return new NotFound("Media object not found") as never;

      const presigned = await infra.presigner.presignGet(
        obj.bucket,
        obj.object_key,
        infra.env.MEDIA_PRESIGN_TTL_SECONDS,
      );
      res.set("Cache-Control", "private, max-age=60");
      return res.redirect(presigned.url) as never;
    }),
  );
  return router;
}
