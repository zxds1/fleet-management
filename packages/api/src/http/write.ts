// packages/api/src/http/write.ts
// The single write path (D8): one transaction per state-changing request, with the audit entry,
// the outbox events and the idempotency completion all staged inside it and flushed pre-COMMIT.
//
// Handlers stay thin (03 §1/§10): validate → executeWrite(service call) → Result → HTTP.
// The audit entry is staged by the handler via `tx.audit(...)` so each domain owns its own record;
// write.ts guarantees only that the idempotency completion commits inside the same transaction.

import type { Request, Response } from "express";
import {
  AppError,
  isErr,
  type IdempotencyService,
  type PoolLike,
  type Principal,
  type Result,
  type Tx,
} from "@fleet/shared";
import { transaction } from "@fleet/db";

export interface WriteDeps {
  pool: PoolLike;
  idempotency: IdempotencyService;
  /** Releases an IN_PROGRESS claim after a transport failure so a client retry can re-run. */
  releaseClaim(subject: string, key: string): Promise<void>;
}

export interface WriteContext {
  principal: Principal | null;
  /** Partition key for idempotency (principal.userId, or email for unauthenticated writes). */
  subject: string;
}

export interface WriteOutcome<T> {
  status: number;
  body: T;
  /** Stashed on the idempotency row so a replay can point at the created resource. */
  resourceId?: string;
}

export type WriteHandler<T> = (tx: Tx, ctx: WriteContext) => Promise<Result<WriteOutcome<T>>>;

export function writeSubject(req: Request): string {
  const principal = (req as { principal?: Principal }).principal;
  if (principal) return principal.userId;
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email === "string" && email.length > 0) return email;
  return req.ip ?? "unknown";
}

/**
 * Runs `fn` inside one transaction and maps the Result onto HTTP.
 *  - Ok  → declared status + body; idempotency key completes COMPLETED in the same tx.
 *  - Err (domain, 4xx) → problem document; key completes FAILED in the same tx (replay re-returns it).
 *  - throw (transport/5xx) → ROLLBACK, the claim is released, the error reaches problemHandler.
 */
export async function executeWrite<T>(
  req: Request,
  res: Response,
  deps: WriteDeps,
  fn: WriteHandler<T>,
): Promise<void> {
  const ctx: WriteContext = {
    principal: (req as { principal?: Principal }).principal ?? null,
    subject: writeSubject(req),
  };
  const claim = (req as { idempotency?: { key: string } }).idempotency;

  try {
    const settled = await transaction(deps.pool, async (tx) => {
      const result = await fn(tx, ctx);

      if (isErr(result)) {
        const problem = { ...result.error.toProblem(), instance: req.requestId };
        if (claim) {
          await deps.idempotency.complete(
            {
              userId: ctx.subject,
              key: claim.key,
              state: "FAILED",
              httpStatus: result.error.httpStatus,
              body: problem,
            },
            tx,
          );
        }
        return { status: result.error.httpStatus, body: problem, failed: true as const };
      }

      const outcome = result.value;
      if (claim) {
        await deps.idempotency.complete(
          {
            userId: ctx.subject,
            key: claim.key,
            state: "COMPLETED",
            httpStatus: outcome.status,
            body: outcome.body,
            ...(outcome.resourceId ? { resourceId: outcome.resourceId } : {}),
          },
          tx,
        );
      }
      return { status: outcome.status, body: outcome.body as unknown, failed: false as const };
    });

    if (settled.failed) {
      res.status(settled.status).type("application/problem+json").json(settled.body);
      return;
    }
    if (settled.status === 204) {
      res.status(204).end();
      return;
    }
    res.status(settled.status).json(settled.body);
  } catch (e) {
    if (claim) {
      await deps.releaseClaim(ctx.subject, claim.key).catch(() => undefined);
    }
    throw unwrap(e);
  }
}

/** The transaction runner wraps domain errors; surface the original AppError to the handler. */
function unwrap(e: unknown): unknown {
  if (e instanceof AppError && e.error_code === "TRANSACTION_FAILED") {
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof AppError) return cause;
  }
  return e;
}
