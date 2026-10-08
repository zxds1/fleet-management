import type { AppError } from './errors';
/** Success-or-error value for code paths that should not throw. */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
