// packages/worker/test/security-anomaly.test.ts
import { detectAnomalies } from "../src/jobs/security-anomaly";

describe("security-anomaly detector (Layer 4)", () => {
  it("flags impossible travel on >=2 distinct auth IPs", () => {
    const findings = detectAnomalies({ distinctAuthIps: ["1.1.1.1", "2.2.2.2"], bulkReadCount: 0 });
    expect(findings.map((f) => f.kind)).toContain("IMPOSSIBLE_TRAVEL");
  });

  it("flags bulk download at/above the threshold", () => {
    const findings = detectAnomalies({ distinctAuthIps: ["1.1.1.1"], bulkReadCount: 25 });
    expect(findings.map((f) => f.kind)).toContain("BULK_DOWNLOAD");
  });

  it("reports no findings for benign activity", () => {
    const findings = detectAnomalies({ distinctAuthIps: ["1.1.1.1"], bulkReadCount: 3 });
    expect(findings).toHaveLength(0);
  });
});
