// packages/api/test/reports.service.test.ts
// Unit tests for ReportsService using a hand-rolled DbClient fake (no DB). These assert the JS-side
// aggregation the service owns: numeric-as-text coercion, the litres-weighted fleet average (a
// rarely-used vehicle must not skew the headline), and the CO2 derivation. The SQL itself is
// exercised by the opt-in integration suite.

import { type DbClient } from "@fleet/shared";
import { ReportsService } from "../src/services/reports";

function clientReturning(rows: unknown[]): DbClient {
  return {
    query: async () => ({ rows, rowCount: rows.length }),
  } as unknown as DbClient;
}

describe("ReportsService.fuelEfficiency", () => {
  it("coerces numeric-as-text and derives totals and CO2", async () => {
    const service = new ReportsService(
      clientReturning([
        { vehicle_id: "v1", vehicle_plate: "KDA 001A", litres: "100.00", cost: "18000.00", efficiency: "30.00" },
        { vehicle_id: "v2", vehicle_plate: "KDA 002B", litres: "50.00", cost: "9000.00", efficiency: "40.00" },
      ]),
    );
    const result = await service.fuelEfficiency();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.total_litres).toBe(150);
    expect(result.value.total_cost).toBe(27000);
    // 150 L x 2.68 kg/L
    expect(result.value.total_co2_kg).toBe(402);
    // Weighted by litres: (30*100 + 40*50) / 150 = 33.33, not the flat mean of 35.
    expect(result.value.avg_efficiency_l_per_100km).toBe(33.33);
    expect(result.value.per_vehicle).toHaveLength(2);
    expect(result.value.per_vehicle[0]).toMatchObject({ vehicle_plate: "KDA 001A", litres: 100, cost: 18000, efficiency: 30 });
  });

  it("reports a null fleet average when no vehicle has an efficiency baseline", async () => {
    const service = new ReportsService(
      clientReturning([{ vehicle_id: "v1", vehicle_plate: "KDA 001A", litres: "10.00", cost: "1800.00", efficiency: null }]),
    );
    const result = await service.fuelEfficiency();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.avg_efficiency_l_per_100km).toBeNull();
    expect(result.value.per_vehicle[0]?.efficiency).toBeNull();
  });

  it("returns zeroed totals for an empty fleet", async () => {
    const service = new ReportsService(clientReturning([]));
    const result = await service.fuelEfficiency();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ total_litres: 0, total_cost: 0, total_co2_kg: 0, avg_efficiency_l_per_100km: null });
    expect(result.value.per_vehicle).toEqual([]);
  });
});

describe("ReportsService.analytics", () => {
  it("coerces every bigint counter to a number", async () => {
    const service = new ReportsService(
      clientReturning([
        {
          active_fleet: "12",
          open_accidents: "2",
          pending_dvir: "5",
          expiring_docs: "3",
          fuel_spend_30d: "125000.50",
          anomalies_open: "7",
        },
      ]),
    );
    const result = await service.analytics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      active_fleet: 12,
      open_accidents: 2,
      pending_dvir: 5,
      expiring_docs: 3,
      fuel_spend_30d: 125000.5,
      anomalies_open: 7,
    });
  });

  it("degrades to zeroes when the counter row is absent", async () => {
    const service = new ReportsService(clientReturning([]));
    const result = await service.analytics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_fleet).toBe(0);
    expect(result.value.fuel_spend_30d).toBe(0);
  });
});
