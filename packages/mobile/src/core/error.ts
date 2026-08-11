// packages/mobile/src/core/error.ts
//
// The mobile-side error shape. Two origins:
//   1. A server response with `error_code` + `message` (docs/backend/08 §1). We normalize the
//      `error_code` into the frozen catalogue via `toKnownErrorCode`. `fatal`/action/disposition
//      come from `errorCodes.ts`.
//   2. A local failure (no network, bad payload, media). We synthesize a pseudo-code in the same
//      namespace so the rest of the app handles one shape.
//
// `ErrorState` components consume this; the offline drainer consumes `disposition`.

import { KnownErrorCode, specFor, toKnownErrorCode } from "./errorCodes";

export interface AppError {
  code: KnownErrorCode;
  /** Server-supplied or synthesized human message — may be unsafe, so components prefer i18n copy. */
  message: string;
  /** Optional field-level hints for VALIDATION_ERROR. */
  fields?: Record<string, string>;
  /** Whether the whole session must be torn down. */
  fatal: boolean;
  /** The single correct action from the mapping table. */
  action: import("./errorCodes").ErrorAction;
  /** Offline-queue disposition for this code. */
  disposition: import("./errorCodes").QueueDisposition;
}

export interface ServerErrorLike {
  error_code?: string | null;
  message?: string | null;
  fields?: Record<string, string> | null;
  /** Backend `ValidationError` shape (08 §1): per-field `[{field, code, message}]`. */
  field_errors?: Array<{ field?: string; code?: string; message?: string }> | null;
}

function flattenFieldErrors(
  fe?: Array<{ field?: string; code?: string; message?: string }> | null,
): Record<string, string> | undefined {
  if (!fe || fe.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const e of fe) {
    const key = e.field ?? e.code ?? "error"
    if (e.message) out[key] = e.message
  }
  return Object.keys(out).length ? out : undefined
}

export function fromServer(err: ServerErrorLike): AppError {
  const code = toKnownErrorCode(err.error_code);
  const spec = specFor(code);
  const fields = err.fields ?? flattenFieldErrors(err.field_errors);
  return {
    code,
    message: err.message ?? "",
    fields,
    fatal: spec.fatal,
    action: spec.action,
    disposition: spec.disposition,
  };
}

export function localError(code: KnownErrorCode, message?: string): AppError {
  const spec = specFor(code);
  return { code, message: message ?? "", fatal: spec.fatal, action: spec.action, disposition: spec.disposition };
}

/** Maps an unknown thrown value into an AppError (network errors, JSON parse, etc.). */
export function fromUnknown(err: unknown): AppError {
  if (err && typeof err === "object" && "code" in err && (err as AppError).code) {
    return err as AppError;
  }
  if (err instanceof TypeError || (err instanceof Error && /network/i.test(err.message))) {
    return localError("NETWORK_UNAVAILABLE", err.message);
  }
  return localError("UNKNOWN", err instanceof Error ? err.message : String(err));
}
