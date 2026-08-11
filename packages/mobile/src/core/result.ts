// packages/mobile/src/core/result.ts
// Minimal Result type (Ok/Err) for the auth + queue flows. Keeps error handling explicit and
// avoids throwing across the React boundary; components switch on `isOk`.

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}
