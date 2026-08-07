// packages/ws/test/smoke.test.ts
import { createState } from "../src/gateway";

describe("@fleet/ws scaffold", () => {
  it("boots", () => {
    expect(createState()).toBeDefined();
  });
});
