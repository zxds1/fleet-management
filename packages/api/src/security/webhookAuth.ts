// packages/api/src/security/webhookAuth.ts
// Authenticates the public Traccar telemetry webhook with an HMAC-SHA256 signature over the raw body
// plus a timestamp replay window (security.md S-1).
//
// Fail-closed: when `enforce` is true (SECURITY_ENFORCE is on) and no WEBHOOK_SECRET is configured,
// every request to the webhook is rejected with 401 — the ingest is never silently open. In dev
// (enforce=false) an unset secret keeps the warning-but-allow pass-through. Whenever a secret is set
// the HMAC is always required, regardless of enforcement mode.

import type { RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger, Unauthenticated } from "@fleet/shared";

const MAX_SKEW_MS = 300_000;

export function webhookAuth(secret?: string, enforce = false): RequestHandler {
  if (!secret) {
    if (enforce) {
      logger.error(
        "webhookAuth: WEBHOOK_SECRET is not set while SECURITY_ENFORCE is on — the telemetry webhook is REFUSING all requests (fail-closed). Set WEBHOOK_SECRET to enable Hmac-protected ingest.",
      );
      return (_req, _res, next) =>
        next(new Unauthenticated("Telemetry webhook is not configured (missing WEBHOOK_SECRET)"));
    }
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
