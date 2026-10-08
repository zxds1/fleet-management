/**
 * Media. Mirrors `fleet-management/packages/shared/src/schemas/media.ts`, which is what the media
 * route actually validates (`packages/api/src/http/routes/media.ts` imports `MediaUploadSchema`).
 *
 * `content_type` is any non-empty string up to 200 chars, so `image/jpeg`, `video/mp4` and the
 * statement-import `text/csv` are all accepted — the earlier guess that the API refused CSV was wrong.
 * A stale sibling (`schemas/auth.ts#MediaUploadRequestSchema`) restricts this to images; nothing
 * imports it, so it is not part of the wire contract.
 */
import { z } from 'zod';
import { MediaOwnerKind, MediaRetentionClass } from '../types';

export const MediaUploadSchema = z.object({
  owner_kind: MediaOwnerKind,
  retention_class: MediaRetentionClass,
  content_type: z.string().min(1).max(200),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
  client_captured_at: z.string().datetime({ offset: true }).optional(),
});
export type MediaUploadInput = z.infer<typeof MediaUploadSchema>;

/** `POST /media/upload-url` (D5): a 60-second pre-signed PUT. */
export const MediaUploadResponseSchema = z.object({
  media_object_id: z.string().uuid(),
  upload_url: z.string().url(),
  expires_in_seconds: z.number().int().positive(),
  method: z.string().default('PUT'),
});

/**
 * `GET /media/{id}` answers with a 302 redirect to a short-lived presigned GET, not a JSON body,
 * so the app hands the id straight to the image loader.
 */
export const MEDIA_REDIRECT_STATUS = 302;

/**
 * There is deliberately NO size or dimension constant here. `MediaUploadSchema` has no size rule and
 * the media service does not check `content-length`, so the photo budget is a product decision that
 * lives in one place: `src/core/policy.ts` (MEDIA_MAX_BYTES / MEDIA_MAX_WIDTH_PX, ledger B-07).
 */