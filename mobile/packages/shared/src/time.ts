/** Kenya (EAT) is UTC+3 all year with no daylight saving, so plain arithmetic is exact. */
const EAT_MS = 3 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const asDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** The Kenyan calendar date (YYYY-MM-DD) of a UTC instant. */
export function toEAT(utc: Date | string | number): string {
  const d = new Date(asDate(utc).getTime() + EAT_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** Kenyan wall-clock time (HH:mm) of a UTC instant. */
export function toEATTime(utc: Date | string | number): string {
  const d = new Date(asDate(utc).getTime() + EAT_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Start (00:00 EAT) of a Kenyan calendar date, as a UTC instant. Throws on malformed input. */
export function fromEAT(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d) - EAT_MS);
  if (toEAT(utc) !== date) throw new RangeError(`Not a real calendar date: "${date}"`);
  return utc;
}
/** Today's Kenyan operational date, as the start of that day. */
export const operationalDate = (now: Date = new Date()): Date => fromEAT(toEAT(now));
export const operationalDateString = (now: Date = new Date()): string => toEAT(now);
