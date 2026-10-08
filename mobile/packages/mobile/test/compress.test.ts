import { describe, it, expect, vi } from 'vitest';
import { compressToLimit } from '../src/core/compress';
const mk = (sizes: Record<number, number>) => vi.fn(async (q: number) => ({ uri: `u${q}`, width: 1080, height: 1920, size: sizes[q] ?? 9e9 }));
describe('compressToLimit', () => {
  it('stops at the first quality that fits 500 KB', async () => { const r = mk({ 0.7: 900_000, 0.55: 480_000, 0.4: 300_000 }); const out = await compressToLimit(r); expect(out).toMatchObject({ uri: 'u0.55', fits: true }); expect(r).toHaveBeenCalledTimes(2); });
  it('a small photo is encoded once', async () => { const r = mk({ 0.7: 100_000 }); await compressToLimit(r); expect(r).toHaveBeenCalledTimes(1); });
  it('returns the smallest attempt with fits=false when nothing fits', async () => { const out = await compressToLimit(mk({ 0.7: 9e6, 0.55: 8e6, 0.4: 7e6, 0.3: 6e6, 0.2: 5e6 })); expect(out).toMatchObject({ uri: 'u0.2', fits: false }); });
  it('honours custom limits and rejects an empty ladder', async () => { expect((await compressToLimit(mk({ 0.7: 50 }), { maxBytes: 100 })).fits).toBe(true); await expect(compressToLimit(mk({}), { qualities: [] })).rejects.toThrow(RangeError); });
});
