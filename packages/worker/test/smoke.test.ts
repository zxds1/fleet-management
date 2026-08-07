// packages/worker/test/smoke.test.ts
// Minimal scaffold check: the consumer class loads without side effects (main() is guarded).
import { IngestConsumer } from "../src/ingest/consumer";

describe("@fleet/worker scaffold", () => {
  it("loads the ingest consumer class", () => {
    expect(typeof IngestConsumer).toBe("function");
  });
});
