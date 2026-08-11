// packages/api/src/security/headers.ts
// Hardens responses with security headers (security.md §1). The API is JSON-only so a strict CSP is
// safe; these headers also defend any future web/WebView surface.

import type { RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), interest-cohort=()",
    );
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    // Force HTTPS for two years, including subdomains, and mark the host as preload-eligible.
    // Only meaningful behind TLS; dev/HTTP is unaffected but the header is still set so it is
    // already present once prod terminates TLS (security Layer 3 — in-transit).
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    next();
  };
}
