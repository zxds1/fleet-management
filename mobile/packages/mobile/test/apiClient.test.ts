import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ApiClient } from '../src/core/apiClient';
import { AppError, ClientProblemError, NetworkError } from '@fleet/shared';
import { classifyResponse, describeError, ERROR_CATALOG } from '../src/core/errors';
import { en } from '../src/i18n/en';
import { sw } from '../src/i18n/sw';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
function client(fetchImpl: any, extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) {
  return new ApiClient({ baseUrl: 'http://x/api/v1', getAccessToken: async () => 'tok', refreshAccessToken: async () => 'tok2', fetchImpl, uuid: () => 'uuid-1', ...extra });
}

describe('ApiClient', () => {
  it('adds Idempotency-Key to writes only', async () => {
    const f = vi.fn(async () => json(200, {}));
    const c = client(f); await c.post('/a', { body: {} }); await c.get('/b');
    expect((f.mock.calls[0] as any)[1].headers['Idempotency-Key']).toBe('uuid-1');
    expect((f.mock.calls[1] as any)[1].headers['Idempotency-Key']).toBeUndefined();
  });
  it('parses RFC7807 into AppError', async () => {
    const c = client(async () => json(422, { error_code: 'ODOMETER_DECREASED', title: 't', detail: 'd' }));
    await expect(c.post('/a', { body: {} })).rejects.toMatchObject({ error_code: 'ODOMETER_DECREASED', status: 422 });
  });
  it('refreshes once on 401 and replays with the SAME idempotency key; concurrent 401s share one refresh', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (_u: string, init: any) => { seen.push(init.headers.Authorization + '|' + init.headers['Idempotency-Key']); return seen.length <= 2 ? json(401, { error_code: 'UNAUTHENTICATED' }) : json(200, {}); });
    const refresh = vi.fn(async () => 'tok2');
    const c = client(f, { refreshAccessToken: refresh });
    await Promise.allSettled([c.post('/a', { body: {} }), c.post('/b', { body: {} })]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen.some((s) => s === 'Bearer tok2|uuid-1')).toBe(true);
  });
  it('calls onAuthLost when refresh fails', async () => {
    const lost = vi.fn();
    const c = client(async () => json(401, {}), { refreshAccessToken: async () => null, onAuthLost: lost });
    await expect(c.get('/a')).rejects.toBeInstanceOf(AppError); expect(lost).toHaveBeenCalled();
  });
  it('wraps fetch failure as NetworkError and validates responses with zod', async () => {
    await expect(client(async () => { throw new TypeError('x'); }).get('/a')).rejects.toBeInstanceOf(NetworkError);
    await expect(client(async () => json(200, { n: 'no' })).get('/a', { schema: z.object({ n: z.number() }) })).rejects.toThrow();
  });
  it('204 resolves undefined; cursor query params skip null', async () => {
    const f = vi.fn(async () => json(204)); const c = client(f);
    expect(await c.post('/a')).toBeUndefined();
    expect(c.buildUrl('/l', { cursor: null, limit: 50 })).toBe('http://x/api/v1/l?limit=50');
  });
});

describe('error catalog', () => {
  it('classifies queue outcomes', () => {
    expect(classifyResponse(201)).toBe('DONE'); expect(classifyResponse(409, 'IDEMPOTENCY_INFLIGHT')).toBe('INFLIGHT_RETRY');
    expect(classifyResponse(422, 'IDEMPOTENCY_CONFLICT')).toBe('DISCARD'); expect(classifyResponse(422, 'VALIDATION_ERROR')).toBe('FAILED_REVIEW');
    expect(classifyResponse(503)).toBe('RETRY_LATER'); expect(classifyResponse(429)).toBe('RETRY_LATER');
  });
  it('every code has en AND sw copy and an action label', () => {
    for (const [code, { key, action }] of Object.entries(ERROR_CATALOG)) {
      expect(key).toBe(`errors.${code}`);
      expect((en.errors as any)[code], `en ${code}`).toBeTruthy(); expect((sw.errors as any)[code], `sw ${code}`).toBeTruthy();
      expect((en.actions as any)[action]).toBeTruthy();
    }
    expect(describeError('NOPE').action).toBe('RETRY');
  });
  it('sw has the same keys as en', () => {
    const keys = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, p + k + '.') : [p + k]);
    expect(keys(sw).sort()).toEqual(keys(en).sort());
  });
});

import { fieldErrorMap } from '../src/core/errors';
describe('field errors and suspension hook', () => {
  it('maps server field_errors and zod issues to field paths', () => {
    const t = (k: string) => (k === 'errors.ODOMETER_DECREASED' ? 'Odometer too low' : k);
    const e = new ClientProblemError(422, 'VALIDATION_ERROR', 'x', undefined, [{ field: 'odometer_km', code: 'ODOMETER_DECREASED', message: 'raw' }, { field: 'litres', code: 'WEIRD', message: 'must be > 0' }]);
    expect(fieldErrorMap(e, t)).toEqual({ odometer_km: 'Odometer too low', litres: 'must be > 0' });
    expect(fieldErrorMap({ issues: [{ path: ['total_cost', 'amount'], message: 'bad' }] }, t)).toEqual({ 'total_cost.amount': 'bad' });
    expect(fieldErrorMap(new Error('x'), t)).toEqual({});
  });
  it('reports every error_code to onErrorCode (used for ACCOUNT_SUSPENDED)', async () => {
    const seen: string[] = [];
    const c = new ApiClient({ baseUrl: 'http://x', getAccessToken: async () => 't', refreshAccessToken: async () => null, fetchImpl: (async () => new Response(JSON.stringify({ error_code: 'ACCOUNT_SUSPENDED' }), { status: 403 })) as any, onErrorCode: (code) => seen.push(code) });
    await c.get('/a').catch(() => null); expect(seen).toEqual(['ACCOUNT_SUSPENDED']);
  });
});
