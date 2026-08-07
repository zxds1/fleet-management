// packages/api/src/middleware/idempotency.ts
// Idempotency-Key enforcement for every state-changing route (C5.1 / D4, 01 §5, 03 §8).
//
//   start(K) → NEW     : claim recorded IN_PROGRESS, handler proceeds
//   start(K) → REPLAY  : cached response returned verbatim, no service call, no side effect
//   IN_PROGRESS        : 409 IDEMPOTENCY_INFLIGHT
//   same key, new body : 422 IDEMPOTENCY_CONFLICT
//
// The completion write happens inside the caller's transaction (see http/write.ts) so the cached
// response commits atomically with the domain mutation (D8).

import type { NextFunction, Request, Response } from "express";
import { ValidationError, type IdempotencyService } from "@fleet/shared";
import { stableHash } from "../security/crypto";
import { writeSubject } from "../http/write";

const HEADER = "idempotency-key";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdempotencyDeps {
  idempotency: IdempotencyService;
}

export function idempotency(deps: IdempotencyDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.header(HEADER);
      if (!key || !UUID_RE.test(key)) {
        throw new ValidationError("Idempotency-Key header is required (C5.1)", [
          {
            field: "Idempotency-Key",
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Send a client-generated UUID v4 with every state-changing request",
          },
        ]);
      }

      const subject = writeSubject(req);
      const endpoint = routeKey(req);
      const requestHash = stableHash({ endpoint, body: req.body ?? null });

      const started = await deps.idempotency.start({
        userId: subject,
        key,
        endpoint,
        requestHash,
      });

      if (started.status === "REPLAY" && started.response) {
        res
          .status(started.response.httpStatus)
          .setHeader("Idempotency-Replayed", "true")
          .json(started.response.body ?? null);
        return;
      }

      req.idempotency = { key, requestHash, endpoint, subject };
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Stable per-route key (the express route pattern, not the concrete path). */
export function routeKey(req: Request): string {
  const pattern = (req.route as { path?: string } | undefined)?.path ?? req.path;
  return `${req.method} ${req.baseUrl}${pattern}`;
}
