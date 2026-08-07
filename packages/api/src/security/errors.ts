// packages/api/src/security/errors.ts
// Security-specific HTTP errors. `RATE_LIMITED` is already in the catalogue (08 §1); `IP_BLOCKED`
// is a new code for an auto/manually blocked source.

import { AppError } from "@fleet/shared";

export class TooManyRequests extends AppError {
  readonly httpStatus = 429;
  readonly error_code = "RATE_LIMITED";
  constructor(detail = "Too many requests, please retry later") {
    super({ title: "Too many requests", detail });
  }
}

export class IpBlocked extends AppError {
  readonly httpStatus = 403;
  readonly error_code = "IP_BLOCKED";
  constructor(detail = "Access temporarily blocked from this address") {
    super({ title: "Forbidden", detail });
  }
}
