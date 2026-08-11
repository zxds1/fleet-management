// scripts/loadtest/api-writes.js
// k6 load test for API write endpoints.
//
// Reference: docs/architecture/00-locked-decisions.md C5.1 —
//   "Idempotency-Key mandatory on every state-changing endpoint."
//
// 50 VUs each create a fuel purchase via POST /api/v1/fuel/purchases, providing
// an Idempotency-Key header on every request, for 5 minutes.
//
// The payload follows the RefuelSchema contract (packages/shared/src/schemas/fuel.ts)
// and the openapi /fuel/refuel request body (api/openapi.yaml §/fuel/refuel).

import http from "k6/http";
import { Trend, Counter } from "k6/metrics";

const writeLatency = new Trend("api_writes_latency", true);
const bodyErrors = new Counter("api_writes_body_errors");

const BASE_URL = __ENV.TARGET_URL || "http://localhost:4000";
const VUS = 50;
const DURATION = __ENV.DURATION || "300s";

const TOKEN = __ENV.BEARER_TOKEN || "";

export const options = {
  scenarios: {
    writes: {
      executor: "per-vu-vus",
      vus: VUS,
      exec: "writesScenario",
    },
  },
  thresholds: {
    "api_writes_latency": ["p(95)<2000"],
    "http_req_failed": ["rate<0.01"],
    "api_writes_body_errors": ["count<1"],
  },
};

const VEHICLE_IDS = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
const CARD_LAST_FOURS = ["1234", "5678", "9012", "3456"];
const SUPPLIERS = ["Shell", "BP", "TotalEnergies", "Gulf Energy"];

function makePayload(vuId, tick) {
  const now = new Date(Date.now() - tick * 1000);
  const vehicleId = VEHICLE_IDS[(vuId - 1) % VEHICLE_IDS.length];
  const cardLastFour = CARD_LAST_FOURS[(vuId + tick) % CARD_LAST_FOURS.length];
  const supplier = SUPPLIERS[tick % SUPPLIERS.length];
  const litres = Math.round(20 + Math.random() * 80);
  const pricePerLitre = 110 + Math.random() * 20;
  const totalCost = (litres * pricePerLitre).toFixed(2);
  const odometerKm = Math.floor(10000 + tick * 50 + Math.random() * 10);

  return {
    shift_id: null,
    vehicle_id: vehicleId,
    fuel_card_last_four: cardLastFour,
    litres: litres,
    total_cost: {
      amount: totalCost,
      currency: "KES",
    },
    odometer_km: odometerKm,
    purchased_at: now.toISOString(),
    before_fuel_record_id: `00000000-0000-0000-0000-${String(tick * 2 + 1).padStart(12, "0")}`,
    after_fuel_record_id: `00000000-0000-0000-0000-${String(tick * 2 + 2).padStart(12, "0")}`,
    receipt_media_object_id: `00000000-0000-0000-0000-${String(1000 + tick).padStart(12, "0")}`,
    supplier_name: supplier,
  };
}

export function setup() {
  if (!TOKEN) {
    console.warn("BEARER_TOKEN not set; write endpoints require authentication and will fail with 401.");
  }
  return { ready: true };
}

export function writesScenario() {
  const start = Date.now();
  let tick = 0;

  while (Date.now() - start < 300000) {
    const payload = makePayload(__VU, tick);
    const body = JSON.stringify(payload);
    const idempotencyKey = `fuel-${__VU}-${tick}-${Date.now()}`;

    const params = {
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(TOKEN ? { "authorization": `Bearer ${TOKEN}` } : {}),
      },
    };

    const res = http.post(`${BASE_URL}/api/v1/fuel/purchases`, body, params);

    const ok = check(res, {
      "status is 201": (r) => r.status === 201,
      "not 5xx": (r) => r.status < 500,
      "response has fuel_purchase_id": (r) => {
        try {
          const j = r.json();
          return j.fuel_purchase_id !== undefined;
        } catch {
          bodyErrors.add(1);
          return false;
        }
      },
    });

    if (!ok) bodyErrors.add(1);

    writeLatency.add(res.timings.duration);

    group("POST /fuel/purchases", () => {
      check(res, {
        "status 201": (r) => r.status === 201,
      });
    });

    tick++;
    sleep(1);
  }
}

export function handleSummary(data) {
  return {
    "./results/api-writes-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}
