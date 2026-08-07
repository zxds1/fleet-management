// packages/api/src/services/media.ts
// Media domain (03 §2.7, D5, C5.3). `uploadUrl` pre-inserts a `media_objects` row (owner_id is NULL
// until the owning row is created in the same transaction, 03 §9), derives the S3 bucket + Object-Lock
// placement from the retention class (ACCIDENT → Object-Locked bucket, C5.3), computes `retain_until`
// from the matching `system_config` threshold (C2.4, no magic numbers), and mints a 60-second presigned
// PUT (D5). Every threshold comes from `ConfigClient`. The binary never transits the API.

import {
  err,
  ok,
  type ConfigClient,
  type Result,
  type Tx,
} from "@fleet/shared";
import type { MediaUploadInput, MediaObjectRow, NumericConfigKey } from "@fleet/shared";
import type { Env } from "../config/env";
import { MediaObjectRepository } from "../repositories/media";
import type { MediaPresigner } from "../media/presigner";
import type { Actor } from "./shift";

/** retention_class → tunable `system_config` threshold (C2.4). */
const RETENTION_KEY: Record<string, NumericConfigKey> = {
  WORK_PLAN: "retention.work_plan_days",
  INSPECTION: "retention.inspection_days",
  FUEL_RECEIPT: "retention.receipt_days",
  FUEL_DASHBOARD: "retention.location_raw_days",
  EXPENSE_RECEIPT: "retention.receipt_days",
  ACCIDENT: "retention.accident_days",
  ASSET_DOCUMENT: "retention.audit_days",
  MAINTENANCE: "retention.audit_days",
  STATEMENT_IMPORT: "retention.audit_days",
  TRAILER_SWAP: "retention.audit_days",
};

/** Seed-mirroring fallbacks, used only if the config row is absent. */
const RETENTION_DEFAULT_DAYS: Record<string, number> = {
  WORK_PLAN: 365,
  INSPECTION: 2557,
  FUEL_RECEIPT: 365,
  FUEL_DASHBOARD: 90,
  EXPENSE_RECEIPT: 365,
  ACCIDENT: 2557,
  ASSET_DOCUMENT: 2557,
  MAINTENANCE: 2557,
  STATEMENT_IMPORT: 2557,
  TRAILER_SWAP: 2557,
};

export interface MediaUploadOutcome {
  mediaObjectId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  method: "PUT";
}

export class MediaService {
  constructor(
    private readonly media: MediaObjectRepository,
    private readonly config: ConfigClient,
    private readonly presigner: MediaPresigner,
    private readonly env: Env,
  ) {}

  async uploadUrl(tx: Tx, actor: Actor, input: MediaUploadInput): Promise<Result<MediaUploadOutcome>> {
    const isAccident = input.retention_class === "ACCIDENT";
    const bucket = isAccident ? this.env.S3_ACCIDENT_BUCKET : this.env.S3_MEDIA_BUCKET;
    const objectKey = `${input.retention_class.toLowerCase()}/${crypto.randomUUID()}`;

    const retentionKey = RETENTION_KEY[input.retention_class] as NumericConfigKey;
    const days = await this.config.numeric(retentionKey, RETENTION_DEFAULT_DAYS[input.retention_class]);
    const retainUntil = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const object = await this.media.insert({
      bucket,
      object_key: objectKey,
      content_type: input.content_type,
      retention_class: input.retention_class,
      retain_until: retainUntil,
      object_lock_applied: isAccident,
      owner_kind: input.owner_kind,
      owner_id: null,
      uploaded_by: actor.userId,
      width_px: input.width_px ?? null,
      height_px: input.height_px ?? null,
      client_captured_at: input.client_captured_at ?? null,
    } as Partial<MediaObjectRow>);

    const presigned = await this.presigner.presignPut(bucket, objectKey, input.content_type, this.env.MEDIA_PRESIGN_TTL_SECONDS);

    tx.audit({
      action: "CREATE",
      entity_table: "app.media_objects",
      entity_id: object.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_role_codes: actor.roles,
      request_id: (tx as { requestId?: string }).requestId,
      endpoint: "/media/upload-url",
      http_method: "POST",
    });

    return ok({ mediaObjectId: object.id, uploadUrl: presigned.url, expiresInSeconds: presigned.expiresInSeconds, method: "PUT" });
  }
}
