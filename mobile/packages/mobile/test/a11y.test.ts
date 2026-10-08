import { describe, it, expect } from 'vitest';
import { color, statusColor, statusGlyph, N5_ORDER, touch, chipHeight } from '../src/design/tokens';

const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

describe('WCAG AA contrast (4.5:1 for text)', () => {
  it.each([
    ['asphalt', 'dust'], ['asphalt', 'paper'], ['mist', 'dust'], ['mist', 'paper'], ['paper', 'verge'], ['paper', 'brake'], ['asphalt', 'hazard'],
    ['brake', 'paper'], ['brake', 'dust'], ['verge', 'paper'], ['verge', 'dust'], ['paper', 'asphalt'],
  ] as const)('%s on %s', (fg, bg) => expect(ratio(color[fg], color[bg])).toBeGreaterThanOrEqual(4.5));
  it.each(N5_ORDER)('white text on the %s badge', (s) => expect(ratio('#FFFFFF', statusColor[s])).toBeGreaterThanOrEqual(4.5));
});

describe('WCAG AAA contrast (7:1 for critical screens: Mayday, clock-in, accidents, login)', () => {
  it.each([
    ['asphalt', 'dust'], ['asphalt', 'paper'], ['asphalt', 'hazard'], ['paper', 'verge'], ['paper', 'brake'],
  ] as const)('%s on %s', (fg, bg) => expect(ratio(color[fg], color[bg])).toBeGreaterThanOrEqual(7));
});

describe('status is never colour alone', () => {
  it('every N5 state has its own glyph and colour', () => { expect(new Set(N5_ORDER.map((s) => statusGlyph[s])).size).toBe(N5_ORDER.length); expect(new Set(N5_ORDER.map((s) => statusColor[s])).size).toBe(N5_ORDER.length); });
  it('touch targets meet platform minimums', () => { expect(touch).toBeGreaterThanOrEqual(48); expect(chipHeight).toBeGreaterThanOrEqual(44); });
});
