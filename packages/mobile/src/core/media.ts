// packages/mobile/src/core/media.ts
//
// Media upload contract (D5). Per the API the client first mints a 60-second pre-signed PUT URL via
// `POST /media/upload-url`, then PUTs the (already EXIF-stripped) bytes directly to object storage and
// references the returned `media_object_id` in the business request. Pure over injected ports
// (`ApiClient` for the ticket, `fetchImpl` for the raw PUT, a `ReadBytesPort` to load the local file)
// so it is unit-testable in node without Metro/native. Never logs the upload URL or bytes (C5.3).

import { ApiClient } from "./apiClient"
import { MediaUploadSchema, type MediaUploadInput } from "@fleet/shared/mobile"
import { NetworkOfflineError } from "./driver/types"

export interface MediaUploadResponse {
  media_object_id: string
  upload_url: string
  expires_in_seconds: number
  method: string
}

export interface ReadBytesPort {
  /** Load the bytes of a captured photo (local uri) for upload. */
  read(uri: string): Promise<Uint8Array>
}

export interface MediaServiceDeps {
  api: ApiClient
  fetchImpl: typeof fetch
  readBytes: ReadBytesPort
  /** Offline gate; when false, `upload` throws `NetworkOfflineError` without touching the network. */
  online?: () => boolean
  now?: () => number
}

export class MediaService {
  constructor(private readonly deps: MediaServiceDeps) {}

  /** Mint a pre-signed URL, PUT the bytes, and return the durable `media_object_id`. */
  async upload(
    photo: { uri: string; width: number; height: number; size: number; createdAt: string },
    meta: MediaUploadInput,
  ): Promise<string> {
    if ((this.deps.online ?? (() => true))() === false) {
      throw new NetworkOfflineError()
    }
    const req = MediaUploadSchema.parse(meta)
    const ticket = await this.deps.api.request<MediaUploadResponse>("/media/upload-url", {
      method: "POST",
      body: req,
    })
    const bytes = await this.deps.readBytes.read(photo.uri)
    const ok = await this.putObject(ticket.upload_url, bytes, meta.content_type)
    if (!ok) throw new NetworkOfflineError("media PUT failed")
    return ticket.media_object_id
  }

  private async putObject(url: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    try {
      const res = await this.deps.fetchImpl(url, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: bytes as unknown as BodyInit,
      })
      return res.ok
    } catch {
      return false
    }
  }
}

/**
 * Offline-first media sequencing (D6 / D-5). Evidence photos must upload *before* the business record
 * that references them is queued, so a replay never references a missing object id. This helper uploads
 * every photo in order (fail-closed: any failure throws, aborting the whole batch so the record write is
 * skipped) and returns the ordered `media_object_id`s ready to embed in the business request.
 */
export async function uploadSequence(
  media: MediaService,
  photos: Array<{ uri: string; width: number; height: number; size: number; createdAt: string }>,
  metaFor: (index: number) => MediaUploadInput,
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const id = await media.upload(photos[i]!, metaFor(i))
    ids.push(id)
  }
  return ids
}
