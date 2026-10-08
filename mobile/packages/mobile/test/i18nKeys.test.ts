import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';
import { sw } from '../src/i18n/sw';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const has = (o: any, path: string) => path.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o) !== undefined;

describe('every literal t("...") key used in the app exists in English and Swahili', () => {
  const files = [...walk('src'), 'App.tsx'];
  const used = new Map<string, string>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*['"`]([a-zA-Z]+(?:\.[A-Za-z_]+)+)['"`]/g)) used.set(m[1]!, f);
  it('finds keys', () => expect(used.size).toBeGreaterThan(100));
  it('no missing keys', () => {
    const missing = [...used].filter(([k]) => !has(en, k) || !has(sw, k)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });
  it('template keys used with a fixed prefix resolve for every variant', () => {
    for (const k of ['MINOR', 'MODERATE', 'SEVERE']) expect(has(en, `accident.${k}`) && has(sw, `accident.${k}`)).toBe(true);
    for (const k of ['FRONT_DAMAGE', 'REAR_DAMAGE', 'SIDE_DAMAGE', 'OTHER_VEHICLE_PLATE']) expect(has(sw, `accident.slot.${k}`)).toBe(true);
    for (const k of ['FUEL', 'HOS', 'ACCIDENT', 'MAINTENANCE', 'SECURITY', 'INFO', 'WARNING', 'ALERT']) expect(has(sw, `anomalies.${k}`)).toBe(true);
    for (const k of ['QUARANTINED', 'OFFLINE', 'HOS_ALERT', 'SPEEDING', 'MOVING', 'IDLING', 'PARKED']) expect(has(sw, `status.${k}`)).toBe(true);
    for (const k of ['active', 'suspended']) expect(has(sw, `drivers.${k}`)).toBe(true);
  });
});
