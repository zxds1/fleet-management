// packages/api/test/media.service.test.ts
// Unit tests for MediaService.uploadUrl using fakes (no DB/S3). Covers the pre-insert of a
// media_objects row, ACCIDENT → Object-Locked bucket placement (C5.3), retain_until derived from the
// retention_class config threshold (C2.4), and the presigned PUT ticket.

import { ok, type Result, type Tx, type ConfigClient, type DbClient } from "@fleet/shared";
import { MediaService } from "../src/services/media";
import type { MediaObjectRow } from "@fleet/shared";
import type { MediaPresigner } from "../src/media/presigner";
import type { Env } from "../src/config/env";

const tx = {
  client: {} as DbClient,
  audit: () => undefined,
  registerOutbox: () => undefined,
} as unknown as Tx;

const env = {
  S3_MEDIA_BUCKET: "fleet-media",
  S3_ACCIDENT_BUCKET: "fleet-accident",
  AWS_REGION: "af-south-1",
  MEDIA_PRESIGN_TTL_SECONDS: 60,
} as unknown as Env;

function makeService(overrides: { retentionDays?: number } = {}) {
  const insertedRows: Record<string, unknown>[] = [];
  const media = {
    insert: async (r: unknown) => {
      insertedRows.push(r as Record<string, unknown>);
      return { id: "mo-1" } as unknown as MediaObjectRow;
    },
  } as unknown as import("../src/repositories/media").MediaObjectRepository;

  const config = {
    numeric: async (_k: string, d?: number) => overrides.retentionDays ?? d ?? 365,
    string: async () => null,
    boolean: async () => false,
  } as unknown as ConfigClient;

  const presigner: MediaPresigner = {
    presignPut: (bucket, key) => ({ url: `https://${bucket}.s3.af-south-1.amazonaws.com/${key}`, method: "PUT", expiresInSeconds: 60 }),
    ping: async () => true,
    deleteObject: async () => undefined,
  };

  return { svc: new MediaService(media, config, presigner, env), insertedRows };
}

const actor = { userId: "user-1", email: "a@b.co", roles: ["DRIVER"] };
const baseInput = {
  owner_kind: "ACCIDENT_REPORT" as const,
  retention_class: "ACCIDENT" as const,
  content_type: "image/jpeg",
};

describe("MediaService.uploadUrl", () => {
  it("pre-inserts a media object and returns a presigned PUT", async () => {
    const { svc } = makeService();
    const r: Result<{ mediaObjectId: string; uploadUrl: string; expiresInSeconds: number; method: "PUT" }> =
      await svc.uploadUrl(tx, actor, baseInput);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mediaObjectId).toBe("mo-1");
      expect(r.value.method).toBe("PUT");
      expect(r.value.uploadUrl).toContain("fleet-accident");
    }
  });

  it("places ACCIDENT media in the Object-Locked bucket (C5.3)", async () => {
    const { svc, insertedRows } = makeService();
    await svc.uploadUrl(tx, actor, baseInput);
    expect(insertedRows[0]!.bucket).toBe("fleet-accident");
    expect(insertedRows[0]!.object_lock_applied).toBe(true);
  });

  it("derives retain_until from the retention_class threshold (C2.4)", async () => {
    const { svc, insertedRows } = makeService({ retentionDays: 2557 });
    await svc.uploadUrl(tx, actor, baseInput);
    const expected = new Date(Date.now() + 2557 * 86_400_000).toISOString().slice(0, 10);
    expect(insertedRows[0]!.retain_until).toBe(expected);
  });

  it("uses the standard bucket for non-accident media", async () => {
    const { svc, insertedRows } = makeService();
    const r = await svc.uploadUrl(tx, actor, { ...baseInput, retention_class: "INSPECTION", owner_kind: "INSPECTION_ITEM" });
    expect(r.ok).toBe(true);
    expect(insertedRows[0]!.bucket).toBe("fleet-media");
  });
});
