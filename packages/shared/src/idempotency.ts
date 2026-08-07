// packages/shared/src/idempotency.ts
// Idempotency contract (C5.1 / D4). The API binds this to app.idempotency_keys.
// See 01-shared-kernel.md §5 for the full state machine.

import type { Tx } from "./transaction";

export interface CachedResponse {
  httpStatus: number;
  body: unknown;
  resourceId?: string;
}

export interface IdempotencyStartInput {
  userId: string;
  key: string;
  endpoint: string;
  requestHash: string;
}

export interface IdempotencyCompleteInput {
  userId: string;
  key: string;
  state: "COMPLETED" | "FAILED";
  httpStatus: number;
  body: unknown;
  resourceId?: string;
}

export interface IdempotencyStartResult {
  status: "NEW" | "REPLAY";
  response?: CachedResponse;
}

export interface IdempotencyService {
  start(input: IdempotencyStartInput): Promise<IdempotencyStartResult>;
  complete(input: IdempotencyCompleteInput, tx: Tx): Promise<void>;
}
