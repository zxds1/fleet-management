// packages/api/src/http/problem.ts
// RFC7807 (application/problem+json) serialisation (D7 / 01 §2). `error_code` is the only
// client-branchable member; the catalogue is frozen in 08-error-state-model.md §1.

import type { NextFunction, Request, Response } from "express";
import { AppError, ServiceUnavailable, TransactionError, logger, reportError } from "@fleet/shared";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** Express error handler. Every error leaves the API as a problem+json document. */
export function problemHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = (req as { requestId?: string }).requestId;
    const appError = toAppError(err);
    const problem = { ...appError.toProblem(), instance: appError.requestId ?? requestId };

    if (problem.status >= 500) {
      logger.error(
        "request failed",
        { requestId, method: req.method, path: req.path, error_code: problem.error_code },
        err,
      );
      reportError(err, {
        error_code: problem.error_code,
        requestId,
        principalId: req.principal?.userId,
        route: `${req.method} ${req.path}`,
      });
    } else {
      logger.warn("request rejected", {
        requestId,
        method: req.method,
        path: req.path,
        status: problem.status,
        error_code: problem.error_code,
      });
    }

    if (res.headersSent) return;
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(stripUndefined(problem));
  };
}

/** Maps any thrown value onto the frozen AppError catalogue (01 §2). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isTransportError(err)) return new ServiceUnavailable((err as Error).message);
  if (err instanceof Error) return new TransactionError(err.message, err);
  return new TransactionError("Unexpected error", err);
}

/** Downstream/transport failures (PG, Redis, S3, Traccar, Vision, FCM) → 503 (01 §3). */
function isTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND" ||
    /connection terminated|pool is (draining|ending)|timeout exceeded/i.test(err.message)
  );
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** Wraps an async handler so rejections reach the problem handler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}
