// packages/api/test/health.test.ts
// Deep + readiness probes (09-observability-ci.md §2). Uses a fake pool (no live PG) so the
// per-check degradation logic is verifiable offline.
import type { FleetPool } from "@fleet/db";
import type { DbClient } from "@fleet/shared";
import { deepHealth, readiness, liveness } from "../src/app/health";
import type { MediaPresigner } from "../src/media/presigner";

function client(rows: unknown[]): DbClient {
  return {
    query: async () => ({ rows: rows as never, rowCount: rows.length }),
    release: () => undefined,
  };
}

function fakePool(connect: () => DbClient): FleetPool {
  return { connect } as unknown as FleetPool;
}

const LAG = client([{ value: 0 }]);
const BACKLOG = client([{ value: 0 }]);
const INGEST = client([{ value: 42 }]);

describe("health probes (09 §2)", () => {
  it("liveness is always ok", () => {
    expect(liveness()).toEqual({ status: "ok" });
  });

  it("deep health reports ok with sane metrics", async () => {
    // connect is called once per check, so return the queued value per call.
    const queue = [LAG, BACKLOG, INGEST];
    const p = fakePool(() => queue.shift() ?? client([]));
    const res = await deepHealth(p);
    expect(res.status).toBe("ok");
    expect(res.checks.map((c) => c.name)).toEqual([
      "replication_lag_seconds",
      "outbox_backlog",
      "last_ingest_age_seconds",
    ]);
    const ingest = res.checks.find((c) => c.name === "last_ingest_age_seconds");
    expect(ingest?.detail).toBe("42");
  });

  it("deep health degrades when a check errors", async () => {
    const p = fakePool(() => {
      throw new Error("connection refused");
    });
    const res = await deepHealth(p);
    expect(res.status).toBe("degraded");
    expect(res.checks.every((c) => c.ok === false)).toBe(true);
  });

  it("readiness checks PG and optional S3", async () => {
    const p = fakePool(() => client([{ value: 1 }]));
    const presigner: MediaPresigner = {
      presignPut: async () => ({ url: "x", method: "PUT", expiresInSeconds: 1 }),
      ping: async () => true,
    };
    const res = await readiness(p, presigner);
    expect(res.status).toBe("ok");
    expect(res.checks.find((c) => c.name === "postgres")?.ok).toBe(true);
    expect(res.checks.find((c) => c.name === "s3")?.ok).toBe(true);
  });

  it("readiness skips S3 when no presigner is supplied", async () => {
    const p = fakePool(() => client([{ value: 1 }]));
    const res = await readiness(p);
    expect(res.status).toBe("ok");
    expect(res.checks.find((c) => c.name === "s3")).toBeUndefined();
  });

  it("readiness degrades when PG is down", async () => {
    const p = fakePool(() => {
      throw new Error("down");
    });
    const res = await readiness(p);
    expect(res.status).toBe("degraded");
  });
});
