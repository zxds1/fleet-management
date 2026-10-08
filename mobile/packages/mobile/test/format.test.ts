import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import { fmtDate, fmtDateTime, fmtTime, currentLocale } from '../src/format';

beforeAll(async () => { await i18next.init({ lng: 'en', resources: {} }); });
describe('format', () => {
  it('always shows Kenyan time regardless of device zone', () => { expect(fmtTime('2026-09-30T12:00:00Z')).toBe('15:00'); expect(fmtTime('2026-09-30T21:30:00Z')).toBe('00:30'); });
  it('dates roll over at Kenyan midnight', () => { expect(fmtDate('2026-09-30T21:30:00Z', 'en-KE')).toContain('1'); expect(fmtDate('2026-09-30T20:30:00Z', 'en-KE')).toContain('30'); });
  it('follows the app language', async () => {
    expect(currentLocale()).toBe('en-KE'); await i18next.changeLanguage('sw'); expect(currentLocale()).toBe('sw-KE'); await i18next.changeLanguage('fr'); expect(currentLocale()).toBe('en-KE'); await i18next.changeLanguage('en');
  });
  it('date + time combine with a comma', () => expect(fmtDateTime('2026-09-30T12:00:00Z', 'en-KE')).toMatch(/2026, 15:00$/));
  it.each(['not a date', '', 'NaN'])('invalid input (%s) renders as empty, never "Invalid Date"', (bad) => { expect(fmtDate(bad)).toBe(''); expect(fmtTime(bad)).toBe(''); expect(fmtDateTime(bad)).toBe(''); });
  it('accepts Date and epoch', () => { const d = new Date('2026-09-30T12:00:00Z'); expect(fmtTime(d)).toBe('15:00'); expect(fmtTime(d.getTime())).toBe('15:00'); });
});
