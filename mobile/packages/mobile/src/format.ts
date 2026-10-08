import i18next from 'i18next';
import { toEAT, toEATTime } from '@fleet/shared';

type D = Date | string | number | null | undefined;
/** Dates always show Kenyan time (EAT). Wording/ordering follows the app language (en or sw). */
export const currentLocale = () => `${i18next.language === 'sw' ? 'sw' : 'en'}-KE`;
const OPTS = { timeZone: 'Africa/Nairobi' } as const;
const ok = (d: D) => d != null && !Number.isNaN(new Date(d).getTime());

export function fmtDate(d: D, locale = currentLocale()) { return ok(d) ? new Date(d as string | number | Date).toLocaleDateString(locale, { ...OPTS, day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
export function fmtTime(d: D) { return ok(d) ? toEATTime(d as string | number | Date) : ''; }                      // 24-hour HH:mm, identical in both languages
export function fmtDateTime(d: D, locale = currentLocale()) { return ok(d) ? `${fmtDate(d, locale)}, ${fmtTime(d)}` : ''; }
export { toEAT };
