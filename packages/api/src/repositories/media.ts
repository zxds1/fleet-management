// packages/api/src/repositories/media.ts
// Media object registry repository (03_platform_core.sql). `media_objects` is soft-deletable (D3),
// so the default `deleted_at` handling applies. The actual binary never touches the API — the service
// mints a 60-second presigned PUT and the client uploads straight to S3 (D5). Parameterised SQL only.

import { BaseRepository } from "@fleet/db";
import type { DbClient, MediaObjectRow } from "@fleet/shared";

export class MediaObjectRepository extends BaseRepository<MediaObjectRow> {
  constructor(client: DbClient) {
    super(client, "app.media_objects");
  }
}
