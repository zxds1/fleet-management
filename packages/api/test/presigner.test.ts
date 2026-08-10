// packages/api/test/presigner.test.ts
// Verifies EnvMediaPresigner mints real AWS SigV4 presigned PUT URLs via the SDK, and degrades to
// the canonical endpoint when credentials are absent (D5).

import { EnvMediaPresigner } from "../src/media/presigner";
import type { Env } from "../src/config/env";

function env(over: Partial<Env>): Env {
  return {
    AWS_REGION: "af-south-1",
    S3_MEDIA_BUCKET: "fleet-media",
    S3_ACCIDENT_BUCKET: "fleet-accident",
    S3_ENDPOINT: undefined,
    S3_FORCE_PATH_STYLE: false,
    MEDIA_PRESIGN_TTL_SECONDS: 60,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,
    AWS_SESSION_TOKEN: undefined,
    ...over,
  } as Env;
}

describe("EnvMediaPresigner (D5 SigV4)", () => {
  it("mints a SigV4 presigned PUT URL with the expected query params (virtual-hosted)", async () => {
    const p = new EnvMediaPresigner(
      env({
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_ENDPOINT: undefined,
        S3_FORCE_PATH_STYLE: false,
      }),
    );
    const out = await p.presignPut("fleet-media", "accident/abc-123", "image/jpeg", 60);

    expect(out.method).toBe("PUT");
    expect(out.expiresInSeconds).toBe(60);
    // Virtual-hosted style: https://<bucket>.s3.<region>.amazonaws.com/<key>?X-Amz-...
    expect(out.url).toContain("fleet-media.s3.af-south-1.amazonaws.com/accident/abc-123?");
    const q = new URL(out.url).searchParams;
    expect(q.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(q.get("X-Amz-Credential")).toContain("AKIA_TEST/");
    expect(q.get("X-Amz-Credential")).toContain("/af-south-1/s3/aws4_request");
    expect(q.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(q.get("X-Amz-Expires")).toBe("60");
    expect((q.get("X-Amz-Signature") ?? "").length).toBe(64);
  });

  it("uses path-style + custom endpoint when configured (MinIO / LocalStack)", async () => {
    const p = new EnvMediaPresigner(
      env({
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_ENDPOINT: "http://localhost:4566",
        S3_FORCE_PATH_STYLE: true,
      }),
    );
    const out = await p.presignPut("fleet-accident", "accident/xyz", "image/png", 120);
    expect(out.url).toContain("http://localhost:4566/fleet-accident/accident/xyz?");
    expect(new URL(out.url).searchParams.get("X-Amz-Expires")).toBe("120");
  });

  it("degrades to the canonical endpoint URL when credentials are absent", async () => {
    const p = new EnvMediaPresigner(env({ AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined }));
    const out = await p.presignPut("fleet-media", "inspection/k1", "image/jpeg", 60);
    expect(out.url).toBe("https://fleet-media.s3.af-south-1.amazonaws.com/inspection/k1");
    expect(out.url).not.toContain("X-Amz-");
  });
});
describe("EnvMediaPresigner.presignGet (F7)", () => {
  it("mints a SigV4 presigned GET URL with the expected query params", async () => {
    const p = new EnvMediaPresigner(
      env({ AWS_ACCESS_KEY_ID: "AKIA_TEST", AWS_SECRET_ACCESS_KEY: "secret", S3_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: false }),
    );
    const out = await p.presignGet("fleet-media", "fuel_receipt/abc-123", 60);
    expect(out.expiresInSeconds).toBe(60);
    expect(out.url).toContain("fleet-media.s3.af-south-1.amazonaws.com/fuel_receipt/abc-123?");
    expect(new URL(out.url).searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect((new URL(out.url).searchParams.get("X-Amz-Signature") ?? "").length).toBe(64);
  });

  it("degrades to the canonical endpoint GET URL when credentials are absent", async () => {
    const p = new EnvMediaPresigner(env({ AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined }));
    const out = await p.presignGet("fleet-media", "fuel_receipt/k1", 60);
    expect(out.url).toBe("https://fleet-media.s3.af-south-1.amazonaws.com/fuel_receipt/k1");
  });
});
