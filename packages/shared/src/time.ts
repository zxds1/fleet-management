// packages/shared/src/time.ts
// Time helpers (A2.3). DB stores UTC timestamptz; EAT is used only for display and
// for the operational-date boundary. operational_date is a generated column in PG,
// so services use operationalDate() for API boundaries and report windows only.

export const OPERATIONAL_TZ = "Africa/Nairobi";

export function nowUtc(): Date {
  return new Date();
}

export function toEAT(d: Date): Date {
  return new Date(d.toLocaleString("en-US", { timeZone: OPERATIONAL_TZ }));
}

// DATE in EAT (matches the generated column on shifts/assignments).
export function operationalDate(d: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(d); // YYYY-MM-DD
}

export type IntervalSpec = { minutes?: number; hours?: number; days?: number };

export function addInterval(d: Date, spec: IntervalSpec): Date {
  const out = new Date(d);
  if (spec.minutes) out.setMinutes(out.getMinutes() + spec.minutes);
  if (spec.hours) out.setHours(out.getHours() + spec.hours);
  if (spec.days) out.setDate(out.getDate() + spec.days);
  return out;
}

export function withinWindow(a: Date, b: Date, spec: IntervalSpec): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= intervalMs(spec);
}

export function intervalMs(spec: IntervalSpec): number {
  const ms =
    (spec.minutes ?? 0) * 60_000 +
    (spec.hours ?? 0) * 3_600_000 +
    (spec.days ?? 0) * 86_400_000;
  return ms;
}
