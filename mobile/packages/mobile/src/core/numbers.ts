/**
 * Parses a number typed on a phone keypad. Some Android locales show a comma as the decimal key, so "45,5" must mean 45.5.
 * Returns null for anything that is not a plain non-negative decimal (no thousands separators, no exponent, no sign).
 */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
/** Whole kilometres only (odometer). */
export function parseWholeNumber(raw: string): number | null { return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null; }
/** Money as the API wants it: a decimal STRING with two places, never a float. */
export function toMoneyString(n: number): string { return n.toFixed(2); }
