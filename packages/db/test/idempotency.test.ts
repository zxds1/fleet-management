// packages/db/test/idempotency.test.ts
import type { DbClient, PoolLike, Tx } from "@fleet/shared";
import { PgIdempotencyService } from "../src/idempotency";

interface Row {
  state: string;
  response_status?: number | null;
  response_body?: unknown;
  resource_id?: string | null;
  request_hash: string;
}

/** In-memory stand-in for app.idempotency_keys keyed by (user_id, idempotency_key). */
class MemClient implements DbClient {
  store = new Map<string, Row>();
  released = false;

  async query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    const p = (params ?? []) as unknown[];
    if (text.includes("INSERT INTO app.idempotency_keys")) {
      const key = `${p[0]}|${p[1]}`;
      if (this.store.has(key)) return { rows: [], rowCount: 0 };
      this.store.set(key, { state: "IN_PROGRESS", request_hash: p[3] as string });
      return { rows: [{ idempotency_key: p[1] }] as unknown as T[], rowCount: 1 };
    }
    if (text.includes("SELECT") && text.includes("app.idempotency_keys")) {
      const row = this.store.get(`${p[0]}|${p[1]}`);
      return { rows: row ? ([row] as unknown as T[]) : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes("UPDATE app.idempotency_keys")) {
      const key = `${p[4]}|${p[5]}`;
      const existing = this.store.get(key);
      if (!existing) return { rows: [], rowCount: 0 };
      this.store.set(key, {
        ...existing,
        state: p[0] as string,
        response_status: p[1] as number,
        response_body: typeof p[2] === "string" ? JSON.parse(p[2] as string) : p[2],
        resource_id: p[3] as string | null,
      });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class MemPool implements PoolLike {
  constructor(public client: MemClient) {}
  async connect(): Promise<DbClient> {
    return this.client;
  }
}

describe("PgIdempotencyService", () => {
  it("returns NEW then REPLAY with cached response", async () => {
    const client = new MemClient();
    const svc = new PgIdempotencyService(new MemPool(client));
    const r1 = await svc.start({ userId: "u1", key: "k1", endpoint: "/x", requestHash: "h1" });
    expect(r1.status).toBe("NEW");

    const tx = { client } as unknown as Tx;
    await svc.complete(
      { userId: "u1", key: "k1", state: "COMPLETED", httpStatus: 201, body: { id: "1" }, resourceId: "1" },
      tx,
    );

    const r2 = await svc.start({ userId: "u1", key: "k1", endpoint: "/x", requestHash: "h1" });
    expect(r2.status).toBe("REPLAY");
    expect(r2.response?.httpStatus).toBe(201);
    expect(r2.response?.body).toEqual({ id: "1" });
    expect(r2.response?.resourceId).toBe("1");
  });

  it("throws IdempotencyInFlight while IN_PROGRESS", async () => {
    const svc = new PgIdempotencyService(new MemPool(new MemClient()));
    await svc.start({ userId: "u1", key: "k2", endpoint: "/x", requestHash: "h1" });
    await expect(svc.start({ userId: "u1", key: "k2", endpoint: "/x", requestHash: "h1" })).rejects.toThrow(
      /in progress/i,
    );
  });

  it("throws IdempotencyConflict when request hash differs", async () => {
    const client = new MemClient();
    const svc = new PgIdempotencyService(new MemPool(client));
    await svc.start({ userId: "u1", key: "k3", endpoint: "/x", requestHash: "h1" });
    const tx = { client } as unknown as Tx;
    await svc.complete({ userId: "u1", key: "k3", state: "COMPLETED", httpStatus: 200, body: {} }, tx);
    await expect(
      svc.start({ userId: "u1", key: "k3", endpoint: "/x", requestHash: "different" }),
    ).rejects.toThrow(/different request body/i);
  });
});
