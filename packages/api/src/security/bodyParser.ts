// packages/api/src/security/bodyParser.ts
// Safe JSON body parser (security.md §3 "input serializations"): replaces express.json. Enforces
// `application/json` content-type, stashes the raw bytes for HMAC verification, and rejects
// prototype-pollution keys (`__proto__`/`constructor`/`prototype`) and over-deep payloads.

import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { ValidationError } from "@fleet/shared";

const MAX_DEPTH = 10;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function checkPayload(value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new ValidationError("Payload too deeply nested");
  if (Array.isArray(value)) {
    for (const item of value) checkPayload(item, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new ValidationError("Disallowed property in request body");
      }
      checkPayload(obj[key], depth + 1);
    }
  }
}

export function safeJson(limit = "1mb"): RequestHandler[] {
  const jsonWithRaw = express.json({
    limit,
    type: "application/json",
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  });

  const pre: RequestHandler = (req, _res, next) => {
    if (!BODY_METHODS.has(req.method)) return next();
    const ct = req.header("content-type");
    if (ct && !ct.toLowerCase().startsWith("application/json")) {
      return next(new ValidationError("Unsupported media type; expected application/json"));
    }
    next();
  };

  const post: RequestHandler = (req, _res, next) => {
    try {
      checkPayload(req.body, 0);
    } catch (e) {
      return next(e);
    }
    next();
  };

  return [pre, jsonWithRaw, post];
}
