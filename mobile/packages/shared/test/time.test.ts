import { describe, it, expect } from 'vitest';
import { fromEAT, operationalDate, operationalDateString, toEAT, toEATTime } from '../src';

describe('EAT time helpers (UTC+3, no DST)', () => {
  it.each([
    ['2026-09-30T20:59:59Z', '2026-09-30'], ['2026-09-30T21:00:00Z', '2026-10-01'], ['2026-01-01T00:00:00Z', '2026-01-01'],
    ['2026-12-31T21:30:00Z', '2027-01-01'], ['2028-02-28T21:00:00Z', '2028-02-29'], ['2027-02-28T21:00:00Z', '2027-03-01'],
  ])('toEAT(%s) = %s', (utc, eat) => expect(toEAT(utc)).toBe(eat));
  it.each([['2026-09-30T12:00:00Z', '15:00'], ['2026-09-30T21:05:00Z', '00:05'], ['2026-09-30T00:00:00Z', '03:00']])('toEATTime(%s) = %s', (u, t) => expect(toEATTime(u)).toBe(t));
  it('accepts Date and epoch numbers', () => { const d = new Date('2026-09-30T22:00:00Z'); expect(toEAT(d)).toBe('2026-10-01'); expect(toEAT(d.getTime())).toBe('2026-10-01'); });
  it('fromEAT is midnight in Nairobi and round-trips with toEAT', () => {
    expect(fromEAT('2026-10-01').toISOString()).toBe('2026-09-30T21:00:00.000Z');
    for (const d of ['2026-01-01', '2026-06-15', '2028-02-29', '2026-12-31']) expect(toEAT(fromEAT(d))).toBe(d);
  });
  it.each(['2026-13-01', '2026-02-30', '26-01-01', '', '2026-1-1', 'tomorrow'])('fromEAT rejects %s', (bad) => expect(() => fromEAT(bad)).toThrow(RangeError));
  it('operationalDate is the start of today in Kenya', () => {
    const now = new Date('2026-09-30T22:30:00Z');
    expect(operationalDateString(now)).toBe('2026-10-01'); expect(operationalDate(now).toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(operationalDate(new Date('2026-09-30T20:00:00Z')).toISOString()).toBe('2026-09-29T21:00:00.000Z');
  });
  it('defaults to the current moment', () => { expect(operationalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(operationalDate()).toBeInstanceOf(Date); });
});
