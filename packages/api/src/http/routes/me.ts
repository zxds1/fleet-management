// packages/api/src/http/routes/me.ts
// Self/consent status endpoints under `${base}/me`. `GET /me/consent` is open to any authenticated
// user (the consent gate applies to everyone, not just drivers) and returns the principal's current
// consent standing against the configured required version (C5.5). The client branches on
// `consented` + `required_version` and refetches after the consent screen records acceptance.

import { Router, type Request, type Response } from "express";
import type { PoolLike, Principal } from "@fleet/shared";
import { authenticate } from "../../middleware/authenticate";
import { asyncHandler } from "../problem";
import { withClient } from "../../db/withClient";
import type { Infra } from "../../app/compose";
import { makeServices } from "../../app/compose";

export interface MeRouterDeps {
  pool: PoolLike;
  infra: Infra;
}

export function createMeRouter(deps: MeRouterDeps): Router {
  const router = Router();
  const { pool, infra } = deps;

  // ── Own consent status (contract status endpoint) ────────────────────────────────────
  router.get(
    "/consent",
    authenticate({ tokens: infra.tokens, sessions: infra.store, strictSessionCheck: infra?.env?.SECURITY_ENFORCE === "always" }),
    asyncHandler((req, res) =>
      withClient(pool, async (client) => {
        const principal = (req as { principal?: Principal }).principal as Principal;
        const svc = makeServices(client, infra);
        const status = await svc.consent.getStatus(principal.userId, infra.env.CONSENT_REQUIRED_VERSION);
        res.status(200).json(status);
      }),
    ),
  );

  return router;
}
