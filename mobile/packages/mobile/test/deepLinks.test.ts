import { describe, it, expect } from 'vitest';
import { parseDeepLink, targetFromNotification } from '../src/core/deepLinks';
const id = '11111111-1111-4111-8111-111111111111';
describe('deep links', () => {
  it('accepts known routes with valid ids for the right role', () => {
    expect(parseDeepLink(`helix://accident/${id}`, 'ADMIN')).toMatchObject({ screen: 'AccidentDetail', params: { id } });
    expect(parseDeepLink('helix://notifications', 'DRIVER')?.screen).toBe('Notifications');
  });
  it('rejects other schemes, bad ids, extra segments, queries, unknown routes and wrong roles', () => {
    for (const u of ['https://evil.com/accident/' + id, `helix://accident/${id}/x`, `helix://accident/${id}?next=http://x`, 'helix://accident/../../etc', 'helix://accident/123', 'helix://admin', 'javascript:alert(1)', `helix://notifications/${id}`])
      expect(parseDeepLink(u, 'ADMIN'), u).toBeNull();
    expect(parseDeepLink(`helix://dvir/${id}`, 'DRIVER')).toBeNull();
    expect(parseDeepLink('helix://notifications', null)).toBeNull();
  });
  it('validates push payloads the same way', () => {
    expect(targetFromNotification({ entity: 'ACCIDENT', id }, 'DRIVER')?.screen).toBe('AccidentDetail');
    expect(targetFromNotification({ entity: 'ACCIDENT', id: 'x' }, 'DRIVER')).toBeNull();
    expect(targetFromNotification('nope', 'DRIVER')).toBeNull();
  });
});

import { decodeJwt } from '../src/core/jwt';
import { parsePins, securityVerdict } from '../src/core/security';
import { substitutePath } from '../src/core/offlineQueue';
describe('jwt / security / paths', () => {
  it('decodes sub from a JWT and tolerates garbage', () => {
    const tok = 'x.' + Buffer.from(JSON.stringify({ sub: 'u-1' })).toString('base64url') + '.y';
    expect(decodeJwt(tok)?.sub).toBe('u-1'); expect(decodeJwt('nope')).toBeNull(); expect(decodeJwt(null)).toBeNull();
  });
  const h = (c: string) => c.repeat(43) + '=';
  it('requires at least two valid pins per host', () => {
    expect(parsePins(JSON.stringify({ 'a.b': [h('A'), 'sha256/' + h('B')] }))?.['a.b']?.publicKeyHashes).toHaveLength(2);
    expect(parsePins(JSON.stringify({ 'a.b': [h('A')] }))).toBeNull(); expect(parsePins('{bad')).toBeNull(); expect(parsePins(undefined)).toBeNull();
  });
  it('fails closed on rooted devices and missing pins in release', () => {
    expect(securityVerdict({ rooted: true, hooked: false, debugged: false, requirePinning: false, pinsConfigured: false, dev: false })).toEqual({ ok: false, reason: 'ROOTED' });
    expect(securityVerdict({ rooted: false, hooked: false, debugged: false, requirePinning: true, pinsConfigured: false, dev: false })).toEqual({ ok: false, reason: 'PINNING_NOT_CONFIGURED' });
    expect(securityVerdict({ rooted: true, hooked: true, debugged: true, requirePinning: true, pinsConfigured: false, dev: true }).ok).toBe(false);
    expect(securityVerdict({ rooted: true, hooked: false, debugged: false, requirePinning: false, pinsConfigured: false, dev: true }).ok).toBe(true);
  });
  it('substitutes tokens inside paths', () => { expect(substitutePath('/accidents/TOK/media', { TOK: 'real' })).toBe('/accidents/real/media'); });
});
