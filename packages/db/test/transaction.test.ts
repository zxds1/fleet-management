// packages/db/test/transaction.test.ts
import type { DbClient, PoolLike, Tx } from "@fleet/shared";
import { transaction } from "../src/transaction";

class FakeClient implements DbClient {
  released = false;
  queries: { text: string; params?: unknown[] }[] = [];
  failNext = false;

  async query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queries.push({ text, params });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("boom");
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool implements PoolLike {
  constructor(public client: FakeClient) {}
  async connect(): Promise<DbClient> {
    return this.client;
  }
}

describe("transaction", () => {
  it("BEGINs, runs fn, flushes audit+outbox, COMMITs, releases", async () => {
    const client = new FakeClient();
    const result = await transaction(new FakePool(client), async (tx: Tx) => {
      tx.audit({ action: "CREATE", entity_table: "shifts", actor_user_id: "u1" });
      tx.registerOutbox({ event_type: "shift.started", aggregate_type: "shift", payload: { id: "1" } });
      return "ok";
    });

    expect(result).toBe("ok");
    const texts = client.queries.map((q) => q.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts).toContain("COMMIT");
    // audit.audit_logs is the authoritative append-only table (C6.5, db/schema/09).
    expect(texts.some((t) => t.includes("INSERT INTO audit.audit_logs"))).toBe(true);
    expect(texts.some((t) => t.includes("INSERT INTO app.outbox_events"))).toBe(true);
    expect(client.released).toBe(true);
  });

  it("stages audit + outbox until just before COMMIT (D8)", async () => {
    const client = new FakeClient();
    await transaction(new FakePool(client), async (tx: Tx) => {
      tx.audit({ action: "UPDATE", entity_table: "shifts" });
      // Nothing may have been written yet: only BEGIN so far.
      expect(client.queries.map((q) => q.text)).toEqual(["BEGIN"]);
      return null;
    });
    const texts = client.queries.map((q) => q.text);
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(texts[texts.length - 2]).toContain("INSERT INTO audit.audit_logs");
  });

  it("ROLLBACKs and releases when fn throws", async () => {
    const client = new FakeClient();
    client.failNext = true;

    await expect(transaction(new FakePool(client), async () => 1)).rejects.toThrow();
    const texts = client.queries.map((q) => q.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts.some((t) => t.includes("ROLLBACK"))).toBe(true);
    expect(client.released).toBe(true);
  });
});
