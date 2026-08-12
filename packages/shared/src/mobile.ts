// packages/shared/src/mobile.ts
// React-Native-safe entry point of @fleet/shared (`@fleet/shared/mobile`).
//
// The root barrel (`./index`) is also client-only: it no longer re-exports the backend-only
// modules (`telemetry.ts` → `@sentry/node`, `transaction` / `outbox` / `idempotency` / `logging` /
// `ingest` service contracts) that cannot be bundled by Metro or have no place in the app.
//
// This module therefore exposes exactly the subset the Expo app needs (docs/apps/IMPLEMENTATION-PROMPT.md
// §3 "verify no Node-only built-ins; shim if needed"):
//   • Result / AppError-RFC7807 (the error_code catalogue the app branches on, 08 §1)
//   • ConfigClient key unions + CONFIG_DEFAULTS (C2.4)
//   • Principal (02 §1) and the generated db row/enum types
//   • the zod request schemas that mirror api/openapi.yaml (the app never redefines shapes)
//   • realtime channel constants (07 §3) and the UTC/EAT time helpers (A2.3)
//
// Everything here is pure TypeScript/zod with no Node built-ins, so Metro bundles it unchanged.

export * from "./result";
export * from "./errors";
export * from "./config";
export * from "./tenancy";
export * from "./schemas/tenancy";
export * from "./time";
export * from "./types/db";
export * from "./types/principal";
export * from "./schemas/auth";
export * from "./schemas/shifts";
export * from "./schemas/fuel";
export * from "./schemas/accidents";
export * from "./schemas/inspections";
export * from "./schemas/trailer";
export * from "./schemas/media";
export * from "./schemas/workplan";
export * from "./schemas/vehicleIssue";
export * from "./schemas/hardware";
export {
  RealtimeChannels,
  RealtimeEvents,
  EVENT_FOR_CHANNEL,
  type RealtimeChannel,
  type RealtimeEvent,
} from "./realtime";
