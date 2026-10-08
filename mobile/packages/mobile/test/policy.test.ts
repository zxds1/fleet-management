import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { POLICY } from '../src/core/policy';

/**
 * B-04 / B-06 / B-07 / B-08 / B-09 / B-19 and friends are PRODUCT numbers, not contract numbers: the
 * backend has no opinion about them. This test is what makes them hard to change silently — every entry
 * must be reachable from `src/core/policy.ts` AND actually used, so a constant cannot drift out of the
 * code or be edited in one place while another copy keeps the old value.
 */
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const code = [...walk('src'), 'App.tsx'].map((p) => readFileSync(p, 'utf8')).join('\n');
const accessors = Object.keys(POLICY).map((k) => new RegExp(`POLICY\\.${k}\\.value|POLICY\\.${k}\\b`));

describe('policy constants are single-sourced and used', () => {
  it('every entry names the ledger entry it came from, and says why', () => {
    for (const [k, v] of Object.entries(POLICY)) {
      expect(typeof v, k).toBe('object');
      expect(v.assumption, k).toMatch(/^[A-Z]-\d{2}$/);
      expect(v.why.length, k).toBeGreaterThan(20);
    }
  });
  it('every entry is either consumed by the app or deliberately delegated to the server', () => {
    // `offlineWindowHours` is intentionally NOT read here: the real value comes from
    // `ConfigClient.numeric('auth.device_offline_max_hours')` so a server-side change is honoured, and the
    // policy copy exists only as the documented fallback and the pinned expectation below.
    const delegatedToServer = new Set(['offlineWindowHours']);
    const policySrc = readFileSync('src/core/policy.ts', 'utf8');
    for (const k of Object.keys(POLICY)) {
      if (delegatedToServer.has(k)) continue;
      expect(new RegExp(`POLICY\\.${k}\\.value`).test(policySrc) || new RegExp(`POLICY\\.${k}\\b`).test(code), k).toBe(true);
    }
    // ...and the delegated one is still referenced, as the local fallback in SessionService.
    expect(code).toMatch(/auth\.device_offline_max_hours/);
  });
  it('there is no second copy of these numbers hiding in the code', () => {
    // A raw 500 KB / 1080 px / 2 s literal outside policy.ts would mean two sources of truth.
    const offenders: string[] = [];
    for (const p of [...walk('src'), 'App.tsx']) {
      const s = readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (p.endsWith('core/policy.ts')) continue;
      if (/500\s*\*\s*1024|\b1080\b|delayLongPress=\{2000\}|\bMAX_INFLIGHT_RETRIES\s*=\s*\d/.test(s)) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });
  it('the values that MUST NOT move without a decision are pinned', () => {
    // The 24 h offline ceiling is the one that can strand a driver's whole shift if it shrinks.
    expect(POLICY.offlineWindowHours.value).toBe(24);
    expect(POLICY.pinDigits.value).toBe(4);
  });
  it('a policy change is a one-line edit, and the accessors point at the entries', () => {
    expect(POLICY.maxAttempts.value).toBe(6);
    expect(POLICY.retryMaxMs.value).toBe(300_000);
    expect(POLICY.maydayHoldMs.value).toBe(2_000);
    expect(POLICY.mediaMaxBytes.value).toBe(512_000);
    expect(POLICY.reviewQueueDays.value).toBe(1);
  });
});
