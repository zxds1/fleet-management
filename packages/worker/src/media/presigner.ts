// packages/worker/src/media/presigner.ts
// Worker-side media object-store boundary (D5, C5.3). The retention job uses `deleteObject` to hard
// delete expired media. When AWS credentials are absent the presigner degrades to a logged no-op so
// the dry-run path never touches S3 (prod wiring supplies credentials + object-lock retention).

import { S3Client, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "@fleet/shared";
import type { Env } from "../config/env";

export interface MediaPresigner {
  /** Hard-deletes a media object (SigV4). No-op when creds are absent; throws on S3 failure. */
  deleteObject(bucket: string, key: string): Promise<void>;
  /** Downloads an object as a Buffer (S-2: for AV scanning). No-op when creds are absent. */
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  /** True when a real S3 client is configured (creds present). */
  enabled(): boolean;
}

export class EnvMediaPresigner implements MediaPresigner {
  private readonly client: S3Client | null;
  private readonly active: boolean;

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
      this.active = true;
    } else {
      this.client = null;
      this.active = false;
    }
  }

  enabled(): boolean {
    return this.active;
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    if (!this.active || !this.client) {
      logger.debug("media: delete skipped (no S3 credentials)", { bucket, key });
      return;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async getObject(bucket: string, key: string): Promise<Buffer | null> {
    if (!this.active || !this.client) {
      logger.debug("media: get skipped (no S3 credentials)", { bucket, key });
      return null;
    }
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body;
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
