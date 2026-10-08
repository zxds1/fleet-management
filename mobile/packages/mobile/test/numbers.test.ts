import { describe, it, expect } from 'vitest';
import { parseDecimal, parseWholeNumber, toMoneyString } from '../src/core/numbers';
describe('keypad numbers', () => {
  it.each([['45.5', 45.5], ['45,5', 45.5], [' 12 ', 12], ['.5', 0.5], ['0', 0], ['2250.00', 2250]])('parseDecimal(%j) = %s', (i, o) => expect(parseDecimal(i)).toBe(o));
  it.each(['', 'abc', '1,000.5', '1.2.3', '-3', '1e3', '12,5,5', '٣'])('parseDecimal rejects %j', (i) => expect(parseDecimal(i)).toBeNull());
  it('parseWholeNumber accepts digits only', () => { expect(parseWholeNumber(' 12345 ')).toBe(12345); for (const b of ['12.5', '-1', '', 'x']) expect(parseWholeNumber(b)).toBeNull(); });
  it('money is a two-place string', () => { expect(toMoneyString(2250.5)).toBe('2250.50'); expect(toMoneyString(0.1 + 0.2)).toBe('0.30'); });
});
