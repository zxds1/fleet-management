// packages/worker/test/retention.job.test.ts
// RetentionJob media-deletion wiring (D6, C5.3): the job must hard-delete expired media objects through
// the injected MediaPresigner when run wet, and skip deletion (dry-run log) otherwise. No live PG/S3 —
// the pool and presigner are faked.

import { RetentionJob } from "../src/jobs/retention";
import type { MediaPresigner } from "../src/media/presigner";
import type { ConfigClient, PoolLike, DbClient } from "@fleet/shared";

function fakePool(rows: { id: string; bucket: string; key: string }[]): PoolLike {
  return {
    connect: async (): Promise<DbClient> =>
      ({
        query: async (sql: string, _params?: unknown[]) => {
          if (sql.includes("fn_drop_expired_location_partitions")) {
            return { rows: [{ dropped: 3 }], rowCount: 1 } as never;
          }
          if (sql.includes("fn_media_due_for_deletion")) {
            return { rows, rowCount: rows.length } as never;
          }
          return { rows: [], rowCount: 0 } as never;
        },
        release: () => undefined,
      }) as never,
  };
}

const config = {
  numeric: async (k: string) => (k === "retention.location_raw_days" ? 90 : 0),
} as unknown as ConfigClient;

describe("RetentionJob media deletion", () => {
  it("deletes each due media object through the presigner when wet", async () => {
    const deleted: { bucket: string; key: string }[] = [];
    const presigner: MediaPresigner = {
      enabled: () => true,
      deleteObject: async (bucket, key) => {
        deleted.push({ bucket, key });
      },
      getObject: async () => null,
    };
    const media = [
      { id: "m1", bucket: "fleet-media", key: "accident/x" },
      { id: "m2", bucket: "fleet-media", key: "receipt/y" },
    ];
    const job = new RetentionJob(fakePool(media), config, presigner);
    const res = await job.run(true);
    expect(res.mediaDeleted).toBe(2);
    expect(res.wet).toBe(true);
    expect(deleted).toEqual([
      { bucket: "fleet-media", key: "accident/x" },
      { bucket: "fleet-media", key: "receipt/y" },
    ]);
  });

  it("does not delete and reports 0 when dry-run (wet=false)", async () => {
    const presigner: MediaPresigner = {
      enabled: () => true,
      deleteObject: async () => {
        throw new Error("must not be called in dry-run");
      },
      getObject: async () => null,
    };
    const job = new RetentionJob(
      fakePool([{ id: "m1", bucket: "b", key: "k" }]),
      config,
      presigner,
    );
    const res = await job.run(false);
    expect(res.mediaDeleted).toBe(0);
    expect(res.mediaDue).toBe(1);
  });

  it("skips deletion silently when no presigner is configured", async () => {
    const job = new RetentionJob(fakePool([{ id: "m1", bucket: "b", key: "k" }]), config);
    const res = await job.run(true);
    expect(res.mediaDeleted).toBe(0);
    expect(res.mediaDue).toBe(1);
  });
});
