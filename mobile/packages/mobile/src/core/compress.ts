import { MEDIA_MAX_BYTES } from './policy';
export interface Rendered { uri: string; width: number; height: number; size: number }
/**
 * Re-encodes an image at decreasing JPEG quality until it fits the upload limit (500 KB). Pure: the platform's resize/encode and
 * file-size calls are injected. Returns the last attempt even if it is still too big, with `fits` so the caller can decide.
 */
export async function compressToLimit(render: (quality: number) => Promise<Rendered>, opts: { qualities?: number[]; maxBytes?: number } = {}): Promise<Rendered & { fits: boolean }> {
  const qualities = opts.qualities ?? [0.7, 0.55, 0.4, 0.3, 0.2]; const max = opts.maxBytes ?? MEDIA_MAX_BYTES; let last: Rendered | null = null;
  for (const q of qualities) { last = await render(q); if (last.size <= max) return { ...last, fits: true }; }
  if (!last) throw new RangeError('no qualities to try');
  return { ...last, fits: false };
}
