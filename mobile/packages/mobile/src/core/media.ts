import { z } from 'zod';
import { ENDPOINTS, url } from '../api/endpoints';
import type { ApiClient } from './apiClient';
import { MediaUploadResponseSchema, type MediaUploadInput } from '@fleet/shared';
import { MEDIA_MAX_BYTES } from './policy';

/** The presign body: `MediaUploadSchema` from the backend, minus the bytes. */
export type MediaMeta = Omit<MediaUploadInput, 'width_px'> & { width_px?: number };

/** Rule 7: presign -> PUT raw bytes straight to object storage -> hand back media_object_id. Never POST bytes to the API. */
export async function uploadMedia(api: ApiClient, bytes: Blob | ArrayBuffer, meta: MediaMeta, fetchImpl: typeof fetch = fetch): Promise<string> {
  const p = await api.post(url(ENDPOINTS.uploadUrl), { body: meta, schema: MediaUploadResponseSchema as z.ZodType<z.infer<typeof MediaUploadResponseSchema>> });
  const res = await fetchImpl(p.upload_url, { method: p.method, headers: { 'Content-Type': meta.content_type }, body: bytes as unknown as RequestInit['body'] });
  if (!res.ok) throw new Error(`S3_UPLOAD_FAILED_${res.status}`);   // presign lasts 60s; caller should re-presign and retry
  return p.media_object_id;
}

/** B-07 (decided): a photo is resized to 1080 px and kept under 500 KB, and video is not offered. The
 *  server does not check the size (MediaUploadSchema has no size rule), so this is a device-side budget
 *  only — which is exactly why the video control was removed rather than left to fail at upload time. */
export const isWithinMediaBudget = (bytes: number): boolean => bytes > 0 && bytes <= MEDIA_MAX_BYTES;