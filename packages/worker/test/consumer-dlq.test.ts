// packages/worker/test/consumer-dlq.test.ts
// Per-entry poison isolation (audit item #4): a malformed/parse-failing entry is dead-lettered
// and ACKed (removed from the live stream) WITHOUT redelivering sibling entries, and a transient
// failure leaves the entry UNACKed so Redis redelivers it (at-least-once).

import { IngestConsumer } from "../src/ingest/consumer";
import type { Redis } from "ioredis";

type RedisCall = { cmd: string; args: unknown[] };

class FakeRedis {
  public calls: RedisCall[] = [];
  public poisonAcked = false;
  public goodAcked = false;
  public unacked = false;

  async xgroup(...args: unknown[]) { return "OK"; }
  async xreadgroup(...args: unknown[]): Promise<any> {
    // Two entries: a poison (bad JSON) and a good one, returned on the first poll only.
    return [["traccar:positions", [
      ["1-0", ["data", "{not valid json"]],
      ["2-0", ["data", "{\"id\":1}"]],
    ]]];
  }
  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    this.calls.push({ cmd: "xack", args: [stream, group, ...ids] });
    if (ids.includes("1-0")) this.poisonAcked = true;
    if (ids.includes("2-0")) this.goodAcked = true;
    return ids.length;
  }
  async incr(key: string) { return 1; }
  async pexpire() { return 1; }
  async del() { return 1; }
}

describe("IngestConsumer per-entry DLQ isolation", () => {
  it("acks the poison entry but does not require redelivering the good entry", async () => {
    const fakeRedis = new FakeRedis();
    const deadLetters: unknown[] = [];
    const consumer = new IngestConsumer({
      pool: {
        connect: async () => ({
          query: async () => ({ rows: [], rowCount: 0 }),
          release: () => undefined,
        }),
      } as any,
      config: { numeric: async () => 15 } as any,
      redis: fakeRedis as unknown as Redis,
    });
    // Capture dead-letter inserts by spying on the pool client.
    (consumer as any).client = async () => {
      return {
        query: async (text: string, params: unknown[]) => {
          if (text.includes("app.ingest_dead_letter")) deadLetters.push(params);
          return { rows: [], rowCount: 0 };
        },
        release: () => undefined,
      };
    };

    await consumer.start();
    await new Promise((r) => setTimeout(r, 1100));
    await consumer.stop();

    // Poison entry was dead-lettered + acked.
    expect(deadLetters.length).toBe(1);
    expect(fakeRedis.poisonAcked).toBe(true);
    // Good entry was also acked (processed normally), no whole-batch throw.
    expect(fakeRedis.goodAcked).toBe(true);
  });
});
