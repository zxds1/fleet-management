import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CATALOG } from '../src/core/errors';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const src = walk('src').map((p) => [p, readFileSync(p, 'utf8')] as const);
const app = readFileSync('App.tsx', 'utf8');

describe('house rules, enforced', () => {
  it('large-text clamp: no file imports Text from react-native except design/Text', () => {
    const bad = [...src, ['App.tsx', app] as const].filter(([p, s]) => !p.endsWith('design/Text.tsx') && /import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(s)).map(([p]) => p);
    expect(bad).toEqual([]);
  });
  it('no screen formats dates itself: Kenyan formatting lives in format.ts only', () => {
    const bad = src.filter(([p, s]) => !p.endsWith('src/format.ts') && /toLocale(Date|Time)?String\(/.test(s)).map(([p]) => p); expect(bad).toEqual([]);
  });
  it('no localStorage/AsyncStorage anywhere (secrets live in SecureStore, cache in encrypted MMKV)', () => { expect(src.filter(([, s]) => /localStorage|AsyncStorage/.test(s)).map(([p]) => p)).toEqual([]); });
  it('no console logging of tokens, PINs or recovery codes', () => { expect(src.filter(([, s]) => /console\.\w+\([^)]*(token|pin|password|recovery)/i.test(s)).map(([p]) => p)).toEqual([]); });
  it('only the session service touches secure-store token keys', () => { expect(src.filter(([p, s]) => !/(session|services|device|cache)\.ts$/.test(p) && /access_token'|refresh_token'/.test(s) && /SecureStore/.test(s)).map(([p]) => p)).toEqual([]); });
  it('no offset pagination', () => { expect(src.filter(([, s]) => /[?&]offset=|offset:/.test(s)).map(([p]) => p)).toEqual([]); });
  it('every ErrorAction in the catalog has a label in the dictionary', async () => {
    const { en } = await import('../src/i18n/en'); for (const { action } of Object.values(ERROR_CATALOG)) expect((en.actions as Record<string, string>)[action]).toBeTruthy();
  });
  it('every writing API call goes through the client (no raw fetch with a body outside the queue/media)', () => {
    const bad = src.filter(([p, s]) => !/(services|offlineQueue|media|apiClient|MediaThumb|PhotoCapture)\.tsx?$/.test(p) && /fetch\([^)]*\{\s*method:\s*'(POST|PUT|PATCH)'/.test(s)).map(([p]) => p); expect(bad).toEqual([]);
  });
});
