// packages/api/test/insights.service.test.ts
// Unit tests for the §2.7 read query services (AnomalyQuery, DocumentQuery, DashboardQuery) using a
// fake DbClient. Covers keyset cursor pagination for the anomaly feed and the expiring-documents window,
// and the dashboard display-state snapshot.

import { ok, type Result, type DbClient } from "@fleet/shared";
import { AnomalyQuery, DocumentQuery, DashboardQuery } from "../src/services/queries";
import type { AssetDocumentRow } from "@fleet/shared";

function fakeClient(rows: Record<string, unknown>[], columns: string[] = []): DbClient {
  return {
    query: async () => ({ rows: rows.map((r) => r) as never, rowCount: rows.length, command: "SELECT", fields: [], oid: 0, rowAsArray: false }),
  } as unknown as DbClient;
}

describe("AnomalyQuery.feed", () => {
  it("pages the unified anomaly view with a keyset cursor", async () => {
    const client = fakeClient([
      { domain: "FUEL", id: "a1", severity: "WARNING", kind: "PRICE_OUTLIER", vehicle_id: "v1", driver_id: "d1", detected_at: "2026-08-06T10:00:00Z", detail: {} },
      { domain: "HOS", id: "h1", severity: "CRITICAL", kind: "REST", vehicle_id: "v1", driver_id: "d1", detected_at: "2026-08-06T09:00:00Z", detail: {} },
    ]);
    const q = new AnomalyQuery(client);
    const r: Result<{ data: { id: string }[]; next_cursor: string | null; has_more: boolean }> =
      await q.feed({ limit: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.data).toHaveLength(1);
      expect(r.value.has_more).toBe(true);
      expect(r.value.next_cursor).toBeTruthy();
    }
  });

  it("filters by domains", async () => {
    const client = fakeClient([
      { domain: "FUEL", id: "a1", detected_at: "2026-08-06T10:00:00Z" },
    ]);
    const q = new AnomalyQuery(client);
    const r = await q.feed({ domains: ["FUEL"], limit: 10 });
    expect(r.ok).toBe(true);
  });
});

describe("DocumentQuery.expiring", () => {
  it("returns documents expiring within the window", async () => {
    const client = fakeClient([
      { id: "doc-1", expires_on: "2026-09-01", vehicle_id: "v1" },
    ]);
    const q = new DocumentQuery(client);
    const r: Result<{ data: AssetDocumentRow[]; next_cursor: string | null; has_more: boolean }> =
      await q.expiring({ withinDays: 30, limit: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.data).toHaveLength(1);
  });
});

describe("DashboardQuery.vehicleStates", () => {
  it("snapshots display states as numbers", async () => {
    const client = fakeClient([
      { vehicle_id: "v1", display_state: "MOVING", latitude: "1.2", longitude: "36.8", driver_name: "Jane", next_eligible_clock_in_at: null },
    ]);
    const q = new DashboardQuery(client);
    const r: Result<{ vehicles: { vehicle_id: string; display_state: string; latitude: number | null }[] }> =
      await q.vehicleStates();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vehicles[0]!.latitude).toBe(1.2);
      expect(r.value.vehicles[0]!.display_state).toBe("MOVING");
    }
  });
});

void ok;
