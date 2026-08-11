// packages/worker/src/jobs/media-scanner.ts
// `media-scanner` job (S-2). Polls app.media_objects for rows still in `quarantine`,
// downloads each object from S3, runs an AV scan via the `clamscan` npm package (which
// talks to a local clamd or invokes the `clamdscan` binary), and on completion:
//   * CLEAN   → flips quarantine_status to `clean`, inserts a media_scans row
//   * VIRUS   → deletes the S3 object, flips status to `quarantined_virus`, inserts a
//                media_scans row, and writes a security audit entry (+ alert)
//   * ERROR   → inserts a media_scans row, leaves status as `quarantine` for retry
//
// When no S3 credentials are configured (dev) the job is a no-op log. When the clamscan
// client is unavailable the scan is recorded as ERROR.

import { transaction } from "@fleet/db";
import { logger } from "@fleet/shared";
import type { PoolLike, EventPublisher } from "@fleet/shared";
import type { MediaPresigner } from "../media/presigner";
import { MediaScanClient, type ScanOutcome } from "../clamav";

export interface MediaScannerDeps {
  pool: PoolLike;
  presigner: MediaPresigner;
  publisher: EventPublisher;
  scanner: MediaScanClient;
}

export interface ScannerResult {
  scanned: number;
  clean: number;
  virus: number;
  errors: number;
}

export class MediaScannerJob {
  constructor(private readonly deps: MediaScannerDeps) {}

  async run(limit = 50, now: Date = new Date()): Promise<ScannerResult> {
    const { pool, presigner, publisher, scanner } = this.deps;

    // Fetch the batch inside a short transaction, then release the lock and scan.
    const pending = await transaction(pool, async (tx) =>
      tx.client.query<{ id: string; bucket: string; object_key: string }>(
        `SELECT id, bucket, object_key
           FROM app.media_objects
          WHERE quarantine_status = 'quarantine' AND deleted_at IS NULL
          ORDER BY uploaded_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      ),
    );

    const rows = pending.rows ?? [];
    let scanned = 0;
    let clean = 0;
    let virus = 0;
    let errors = 0;

    for (const obj of rows) {
      try {
        const buffer = await presigner.getObject(obj.bucket, obj.object_key);
        if (buffer === null) {
          // S3 not configured — record an ERROR so the row stays quarantined and ops can see it.
          await recordError(pool, obj.id, "S3 credentials absent; object not scanned");
          errors++;
          continue;
        }

        const outcome: ScanOutcome = await scanner.scanBuffer(buffer, `${obj.bucket}/${obj.object_key}`);
        if (outcome.status === "CLEAN") {
          await transaction(pool, async (tx) => {
            await tx.client.query(
              `INSERT INTO app.media_scans (media_object_id, status, scan_result, scanner_version)
               VALUES ($1, 'CLEAN', $2, $3)`,
              [obj.id, outcome.detail ?? null, outcome.scannerVersion ?? null],
            );
            await tx.client.query(
              `UPDATE app.media_objects SET quarantine_status = 'clean' WHERE id = $1`,
              [obj.id],
            );
          });
          clean++;
          scanned++;
        } else if (outcome.status === "VIRUS") {
          await transaction(pool, async (tx) => {
            await tx.client.query(
              `INSERT INTO app.media_scans (media_object_id, status, scan_result, scanner_version)
               VALUES ($1, 'VIRUS', $2, $3)`,
              [obj.id, outcome.detail ?? null, outcome.scannerVersion ?? null],
            );
            await tx.client.query(
              `UPDATE app.media_objects SET quarantine_status = 'quarantined_virus' WHERE id = $1`,
              [obj.id],
            );
            tx.audit({
              action: "QUARANTINE",
              entity_table: "app.media_objects",
              entity_id: obj.id,
              reason: "AV_SCAN_HIT",
              new_value: { quarantine_status: "quarantined_virus", scan_result: outcome.detail ?? null },
            });
          });
          // Delete the infected S3 object (isolate).
          await presigner.deleteObject(obj.bucket, obj.object_key);
          await publisher.publish("media.virus_detected", {
            media_object_id: obj.id,
            bucket: obj.bucket,
            object_key: obj.object_key,
            scan_result: outcome.detail ?? null,
            detected_at: now.toISOString(),
          });
          virus++;
          scanned++;
        } else {
          // ERROR — leave quarantined for retry.
          await transaction(pool, async (tx) => {
            await tx.client.query(
              `INSERT INTO app.media_scans (media_object_id, status, scan_result, scanner_version)
               VALUES ($1, 'ERROR', $2, $3)`,
              [obj.id, outcome.detail ?? null, outcome.scannerVersion ?? null],
            );
          });
          errors++;
        }
      } catch (e) {
        const msg = (e as Error).message;
        logger.error("media-scanner row error", { mediaObjectId: obj.id, message: msg });
        await recordError(pool, obj.id, msg);
        errors++;
      }
    }

    logger.info("media-scanner complete", { scanned, clean, virus, errors });
    return { scanned, clean, virus, errors };
  }
}

/** Records an ERROR scan row without changing quarantine_status (retryable). */
async function recordError(pool: PoolLike, mediaObjectId: string, message: string): Promise<void> {
  await transaction(pool, async (tx) => {
    await tx.client.query(
      `INSERT INTO app.media_scans (media_object_id, status, scan_result, scanner_version)
       VALUES ($1, 'ERROR', $2, null)`,
      [mediaObjectId, message],
    );
  });
}
