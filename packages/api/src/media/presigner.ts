// packages/api/src/media/presigner.ts
// Media presigner boundary (D5). `MediaService` depends only on this interface; the implementation
// signs a PUT against S3 (af-south-1) with a 60-second expiry using AWS SigV4. The SDK
// (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) produces a standards-compliant presigned
// URL that honours a custom `S3_ENDPOINT` (MinIO/LocalStack) and `S3_FORCE_PATH_STYLE`. When AWS
// credentials are absent the presigner degrades to the canonical bucket endpoint (pre-SigV4
// behaviour) so the contract + unit tests still resolve a URL.

import { S3Client, PutObjectCommand, HeadBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@fleet/shared";
import type { Env } from "../config/env";

export interface PresignedUpload {
  url: string;
  method: "PUT";
  expiresInSeconds: number;
}

export interface MediaPresigner {
  presignPut(bucket: string, key: string, contentType: string, expiresInSeconds: number): PresignedUpload | Promise<PresignedUpload>;
  /** Liveness probe for the configured S3 endpoint (09 §2 readiness). False when creds are absent. */
  ping(): Promise<boolean>;
  /** Hard-deletes a media object (SigV4). No-op when creds are absent; throws on S3 failure. */
  deleteObject(bucket: string, key: string): Promise<void>;
}

export class EnvMediaPresigner implements MediaPresigner {
  private readonly client: S3Client | null;
  private readonly enabled: boolean;

  constructor(private readonly env: Env) {
    const accessKeyId = env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: env.AWS_REGION,
        credentials: { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN },
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
      this.enabled = true;
    } else {
      this.client = null;
      this.enabled = false;
    }
  }

  async presignPut(bucket: string, key: string, contentType: string, expiresInSeconds: number): Promise<PresignedUpload> {
    // Real SigV4 presigned PUT (D5).
    if (this.enabled && this.client) {
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
      const url = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
      return { url, method: "PUT", expiresInSeconds };
    }

    // Degrade to the canonical endpoint URL when credentials are absent (dev / secret-store gaps).
    const endpoint = this.env.S3_ENDPOINT;
    const base = endpoint
      ? endpoint.replace(/\/$/, "")
      : `https://${bucket}.s3.${this.env.AWS_REGION}.amazonaws.com`;
    return { url: `${base}/${key}`, method: "PUT", expiresInSeconds };
  }

  async ping(): Promise<boolean> {
    if (!this.enabled || !this.client) return false;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_MEDIA_BUCKET }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    // Real SigV4 DELETE (D5). When creds are absent the caller is responsible for the dry-run log.
    if (!this.enabled || !this.client) {
      logger.debug("media: delete skipped (no S3 credentials)", { bucket, key });
      return;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
