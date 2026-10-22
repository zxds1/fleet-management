// packages/api/src/security/webhookAuth.ts
// Authenticates the public Traccar telemetry webhook with an HMAC-SHA256 signature over the
// timestamp and the raw body, plus a timestamp replay window (security.md S-1).
//
// SIGNING RECIPE (integrators must implement exactly this):
//
//   signed_material = <x-timestamp header value> + "." + <raw request body bytes>
//   x-signature     = "sha256=" + lowercase_hex( HMAC_SHA256(secret, signed_material) )
//
// The timestamp is part of the signed material, so a captured (signature, timestamp, body) triple
// cannot be replayed with a fresh timestamp — and the freshness window is 120 seconds.
//
// Fail-closed: when `enforce` is true (SECURITY_ENFORCE is on) and no WEBHOOK_SECRET is configured,
// every request to the webhook is rejected with 401 — the ingest is never silently open. In dev
// (enforce=false) an unset secret keeps the warning-but-allow pass-through. Whenever a secret is set
// the HMAC is always required, regardless of enforcement mode.

import type { RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger, Unauthenticated } from "@fleet/shared";

/** Replay window for the signed timestamp. */
const MAX_SKEW_MS = 120_000;

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
    const signedMaterial = Buffer.concat([Buffer.from(ts, "utf8"), Buffer.from(".", "utf8"), raw]);
    const expected = "sha256=" + createHmac("sha256", secret).update(signedMaterial).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return next(new Unauthenticated("Invalid webhook signature"));
    }
    next();
  };
}
