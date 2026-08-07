// packages/api/src/http/requestContext.ts
// Per-request correlation id (09 §1): threaded into logs, AppError.requestId, the RFC7807
// `instance` member and audit_logs.request_id so one operation is traceable API → outbox → worker.

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Principal } from "@fleet/shared";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
      /** Raw request bytes, stashed by the safe JSON body parser for HMAC verification. */
      rawBody?: Buffer;
      /** Set by the idempotency middleware for state-changing routes (C5.1). */
      idempotency?: { key: string; requestHash: string; endpoint: string; subject: string };
    }
  }
}

const HEADER = "x-request-id";

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(HEADER);
    req.requestId = isUuid(incoming) ? (incoming as string) : randomUUID();
    res.setHeader(HEADER, req.requestId);
    next();
  };
}

function isUuid(value: string | undefined): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
