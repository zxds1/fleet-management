// scripts/loadtest/telemetry-ingest.js
// k6 load test for the Traccar GPS webhook ingestion endpoint.
//
// Reference: docs/architecture/00-locked-decisions.md C5.8 —
//   "telemetry load test at 50 devices × 10s"
//
// 50 VUs simulate 50 GPS trackers, each posting a position every 10 seconds
// (the real Traccar ping interval per A2.4) for 5 minutes (300 s).
//
// The payload matches the public shape accepted by POST /api/v1/telemetry/webhook
// (packages/shared/src/ingest.ts TraccarWebhookSchema), normalised by the API
// onto the raw Traccar position the worker consumes (packages/worker/src/ingest/traccar.ts).
//
// HMAC signing is applied when WEBHOOK_SECRET is set, mirroring the webhookAuth
// middleware (packages/api/src/security/webhookAuth.ts): an x-signature header
// carrying sha256=<hmac> and an x-timestamp header (epoch ms).

import http from "k6/http";
import { hmac } from "k6/crypto";
import { Trend, Counter } from "k6/metrics";

const ingestLatency = new Trend("telemetry_ingest_latency", true);
const bodyErrors = new Counter("telemetry_body_errors");

const BASE_URL = __ENV.TARGET_URL || "http://localhost:4000";
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || "";
const VEHICLE_COUNT = 50;
const PING_INTERVAL_SEC = 10;
const DURATION = __ENV.DURATION || "300s";

const VEHICLE_IDS = Array.from({ length: VEHICLE_COUNT }, (_, i) => 1000 + i);

const NAIROBI_LAT = -1.2921;
const NAIROBI_LNG = 36.8219;

export const options = {
  scenarios: {
    telemetry: {
      executor: "per-vu-vus",
      vus: VEHICLE_COUNT,
      exec: "telemetryScenario",
    },
  },
  thresholds: {
    "telemetry_ingest_latency": ["p(95)<200", "p(99)<500"],
    "http_req_failed": ["rate<0.05"],
    "telemetry_body_errors": ["count<1"],
  },
};

function signBody(body, secret) {
  if (!secret) return { headers: { "content-type": "application/json" } };
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const sig = "sha256=" + hmac("sha256", raw, secret, "hex");
  const ts = String(Date.now());
  return {
    headers: {
      "content-type": "application/json",
      "x-signature": sig,
      "x-timestamp": ts,
    },
  };
}

function makePosition(vuId, tick) {
  const now = new Date(Date.now() - (tick * PING_INTERVAL_SEC * 1000));
  const jitterLat = (Math.random() - 0.5) * 0.001;
  const jitterLng = (Math.random() - 0.5) * 0.001;
  const speed = Math.round(Math.random() * 80);
  const ignition = speed > 0;

  return {
    deviceId: VEHICLE_IDS[vuId - 1],
    lat: NAIROBI_LAT + jitterLat,
    lon: NAIROBI_LNG + jitterLng,
    speed: speed,
    heading: Math.floor(Math.random() * 360),
    ignition: ignition,
    timestamp: now.toISOString(),
    attributes: {
      odometer: Math.floor(10000 + tick * 5 + Math.random() * 10),
      fuel: Math.max(5, Math.floor(80 - (tick * 0.1) + Math.random() * 3)),
      engineHours: Math.floor(100 + tick * 0.1),
      satellites: 12,
      hdop: 1.2,
    },
  };
}

export function setup() {
  const res = http.get(`${BASE_URL}/api/v1/telemetry/webhook`);
  if (res.status !== 404 && res.status !== 405) {
    console.warn(`Webhook endpoint returned ${res.status} on GET; expected 404/405.`);
  }
  return { ready: true };
}

export function telemetryScenario() {
  const startTime = Date.now();
  let tick = 0;

  while (Date.now() - startTime < 300000) {
    const payload = makePosition(__VU, tick);
    const body = JSON.stringify(payload);
    const params = signBody(body, WEBHOOK_SECRET);

    const res = http.post(`${BASE_URL}/api/v1/telemetry/webhook`, body, params);

    const ok = check(res, {
      "status is 202": (r) => r.status === 202,
      "response has accepted": (r) => {
        try {
          const j = r.json();
          return j.accepted === true;
        } catch {
          bodyErrors.add(1);
          return false;
        }
      },
    });

    if (!ok) {
      bodyErrors.add(1);
    }

    ingestLatency.add(res.timings.duration);

    group(`device_${__VU}_tick_${tick}`, () => {
      check(res, {
        "status is 202": (r) => r.status === 202,
      });
    });

    tick++;
    sleep(PING_INTERVAL_SEC);
  }
}

export function handleSummary(data) {
  return {
    "./results/telemetry-ingest-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}
