// packages/api/src/security/webhookAuth.ts
// Authenticates the public Traccar telemetry webhook with an HMAC-SHA256 signature over the raw body
// plus a timestamp replay window (security.md S-1). When no WEBHOOK_SECRET is configured it is a
// pass-through and logs a warning, so the endpoint is never silently "secure" without a secret.

import type { RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger, Unauthenticated } from "@fleet/shared";

const MAX_SKEW_MS = 300_000;

export function webhookAuth(secret?: string): RequestHandler {
  if (!secret) {
    logger.warn(
      "webhookAuth: WEBHOOK_SECRET is not set — the telemetry webhook is UNPROTECTED. Set WEBHOOK_SECRET to enforce HMAC.",
    );
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const raw = (req as { rawBody?: Buffer }).rawBody;
    const sig = req.header("x-signature");
    const ts = req.header("x-timestamp");
    if (!raw || !sig || !ts) {
      return next(new Unauthenticated("Missing webhook authentication"));
    }
    const age = Date.now() - Number(ts);
    if (!Number.isFinite(age) || Math.abs(age) > MAX_SKEW_MS) {
      return next(new Unauthenticated("Webhook timestamp expired"));
    }
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return next(new Unauthenticated("Invalid webhook signature"));
    }
    next();
  };
}
