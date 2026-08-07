// packages/api/src/security/cors.ts
// Minimal, explicit CORS (security.md §1). Only echoes configured origins; never reflects arbitrary
// origins. React Native does not send an Origin header, so this is a no-op for the apps and only
// protects any future browser client. Preflight (OPTIONS) is answered directly.

import type { RequestHandler } from "express";

export function corsMiddleware(allowedOrigins: string): RequestHandler {
  const origins = allowedOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (req, res, next) => {
    const origin = req.header("origin");
    if (origin && origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key, X-Signature, X-Timestamp",
      );
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
