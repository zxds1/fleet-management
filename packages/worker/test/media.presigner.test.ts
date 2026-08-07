// packages/worker/test/media.presigner.test.ts
// Worker EnvMediaPresigner (D5, C5.3): enabled only when AWS creds are present; deleteObject is a
// logged no-op when disabled and performs a real SigV4 DELETE when enabled. The enabled/skip branch
// is unit-tested without hitting S3; the real SDK call is covered by the integration path.

import { EnvMediaPresigner } from "../src/media/presigner";
import { env as loadEnv, resetEnv } from "../src/config/env";

describe("EnvMediaPresigner", () => {
  afterEach(() => resetEnv());

  it("is disabled and skips delete when no AWS credentials are configured", async () => {
    process.env.AWS_ACCESS_KEY_ID = "";
    process.env.AWS_SECRET_ACCESS_KEY = "";
    process.env.AWS_REGION = "af-south-1";
    process.env.S3_MEDIA_BUCKET = "fleet-media";
    const e = loadEnv();
    const p = new EnvMediaPresigner(e);
    expect(p.enabled()).toBe(false);
    await expect(p.deleteObject("fleet-media", "accident/x")).resolves.toBeUndefined();
  });

  it("is enabled when credentials are present (SigV4 path is live)", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_REGION = "af-south-1";
    process.env.S3_MEDIA_BUCKET = "fleet-media";
    const e = loadEnv();
    const p = new EnvMediaPresigner(e);
    expect(p.enabled()).toBe(true);
  });
});
