// packages/api/src/http/pagination.ts
// Cursor (keyset) pagination (D7 / 03 §7). The cursor is an opaque base64 of the last row's
// sort tuple; the sort column always comes from a code allow-list, never from request input
// (00 §4 invariant 1).

import { ValidationError } from "@fleet/shared";
import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export interface CursorPage<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface Cursor {
  /** Value of the primary sort column of the last row on the previous page. */
  sort: string;
  /** Tie-breaker id of the last row on the previous page. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    const shape = z.object({ sort: z.string(), id: z.string() }).safeParse(parsed);
    if (!shape.success) throw new Error("bad cursor shape");
    return shape.data;
  } catch {
    throw new ValidationError("Malformed cursor", [
      { field: "cursor", code: "INVALID_CURSOR", message: "Cursor is not a valid page token" },
    ]);
  }
}

/**
 * Builds the page envelope. Callers fetch `limit + 1` rows so `has_more` needs no count query.
 */
export function buildPage<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
    has_more: hasMore,
  };
}

/**
 * Resolves a caller-supplied sort key against a code allow-list. Anything not in the list is a
 * validation error — dynamic identifiers never reach SQL from the request (06 §2).
 */
export function resolveSortColumn<T extends Record<string, string>>(
  allowList: T,
  requested: string | undefined,
  fallback: keyof T,
): string {
  if (!requested) return allowList[fallback] as string;
  const column = allowList[requested as keyof T];
  if (!column) {
    throw new ValidationError("Unsupported sort column", [
      { field: "sort", code: "SORT_NOT_ALLOWED", message: `Allowed: ${Object.keys(allowList).join(", ")}` },
    ]);
  }
  return column;
}
