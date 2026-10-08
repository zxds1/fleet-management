import { describe, it, expect, afterEach } from 'vitest';
import { configureRandomBytes, newId } from '../src/core/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
afterEach(() => configureRandomBytes(null));
describe('newId (Hermes has no global crypto.randomUUID)', () => {
  it('produces RFC 4122 v4 ids that the API\'s uuid() validation accepts', () => { for (let i = 0; i < 200; i++) expect(newId()).toMatch(V4); });
  it('ids do not repeat', () => expect(new Set(Array.from({ length: 5000 }, newId)).size).toBe(5000));
  it('uses the platform source when one is configured, and sets the version/variant bits', () => {
    configureRandomBytes((a) => a.fill(0xff)); expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    configureRandomBytes((a) => a.fill(0x00)); expect(newId()).toBe('00000000-0000-4000-8000-000000000000');
  });
  it('with NO secure source it throws instead of silently using Math.random', () => {
    const g = globalThis as { crypto?: unknown }; const saved = g.crypto; Object.defineProperty(g, 'crypto', { value: undefined, configurable: true });
    try { expect(() => newId()).toThrow(/secure random/i); } finally { Object.defineProperty(g, 'crypto', { value: saved, configurable: true }); }
  });
});
