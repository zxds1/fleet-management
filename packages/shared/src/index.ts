// packages/shared/src/index.ts
// Public API of @fleet/shared. Import this from @fleet/api, @fleet/worker, @fleet/ws,
// and the mobile/admin apps so all consumers share identical types.

export * from "./result";
export * from "./errors";
export * from "./slo";
export * from "./config";
export * from "./transaction";
export * from "./idempotency";
export * from "./outbox";
export * from "./logging";
export * from "./metrics";
export * from "./time";
export * from "./types/db";
export * from "./types/principal";
export * from "./tenancy";
export * from "./schemas/auth";
export * from "./schemas/mfa";
export * from "./schemas/tenancy";
export * from "./schemas/vehicles";
export * from "./schemas/shifts";
export * from "./schemas/fuel";
export * from "./schemas/accidents";
export * from "./schemas/inspections";
export * from "./schemas/trailer";
export * from "./schemas/media";
export * from "./schemas/privacy";
export * from "./schemas/vehicleIssue";
export * from "./schemas/status";
export * from "./realtime";
export * from "./telemetry";
export * from "./ingest";
