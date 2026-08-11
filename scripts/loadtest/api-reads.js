// scripts/loadtest/api-reads.js
// k6 load test for API read endpoints at 2× expected peak traffic.
//
// Reference: docs/architecture/00-locked-decisions.md C5.8 —
//   "API at 2× expected peak traffic"
//
// 200 VUs (2× the ~100 expected concurrent) sequentially poll four read endpoints
// with a 2s think time between requests, for 10 minutes.
//
// Endpoints tested:
//   GET /api/v1/dashboard/vehicle-states  (insights.ts — N5 vehicle display-state snapshot)
//   GET /api/v1/vehicles                  (vehicles.ts — cursor list, requires asset:read)
//   GET /api/v1/shifts/me/active          (shifts.ts — active shift for the caller)
//   GET /api/v1/incidents                 (incident feed — see README for availability note)
//
// Note: /api/v1/incidents is referenced in C5.8's load-test scope. If the integration
// environment does not yet expose it, expect 404s. The test still exercises the
// other three endpoints and reports the incidents status for triage.

import http from "k6/http";
import { Trend, Counter } from "k6/metrics";

const readLatency = new Trend("api_reads_latency", true);
const notFound = new Counter("api_reads_404");
const errors = new Counter("api_reads_errors");

const BASE_URL = __ENV.TARGET_URL || "http://localhost:4000";
const VUS = 200;
const DURATION = __ENV.DURATION || "600s";

export const options = {
  scenarios: {
    reads: {
      executor: "per-vu-vus",
      vus: VUS,
      exec: "readsScenario",
    },
  },
  thresholds: {
    "api_reads_latency": ["p(95)<500"],
    "http_req_failed": ["rate<0.01"],
    "api_reads_404": ["count<=500"],
    "api_reads_errors": ["count<1"],
  },
};

const TOKEN = __ENV.BEARER_TOKEN || "";

const params = {
  headers: {
    "accept": "application/json",
    ...(TOKEN ? { "authorization": `Bearer ${TOKEN}` } : {}),
  },
};

const ENDPOINTS = [
  "/api/v1/dashboard/vehicle-states",
  "/api/v1/vehicles",
  "/api/v1/shifts/me/active",
  "/api/v1/incidents",
];

export function setup() {
  if (!TOKEN) {
    console.warn("BEARER_TOKEN not set; read endpoints require authentication and will fail with 401.");
  }
  return { ready: true };
}

export function readsScenario() {
  const start = Date.now();

  while (Date.now() - start < 600000) {
    for (const endpoint of ENDPOINTS) {
      const res = http.get(`${BASE_URL}${endpoint}`, params);

      if (res.status === 404) notFound.add(1);

      const ok = check(res, {
        "status is 200": (r) => r.status === 200,
        "not 5xx": (r) => r.status < 500,
        "content-type is json": (r) => r.headers["content-type"]?.includes("application/json"),
      });

      if (!ok) errors.add(1);

      readLatency.add(res.timings.duration);

      group(`GET ${endpoint}`, () => {
        check(res, {
          "status 200": (r) => r.status === 200,
        });
      });

      sleep(2);
    }
  }
}

export function handleSummary(data) {
  return {
    "./results/api-reads-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}
