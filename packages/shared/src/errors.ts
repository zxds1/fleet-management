// packages/shared/src/errors.ts
// AppError hierarchy + RFC7807 (application/problem+json) serialisation.
// error_code is the ONLY member the client branches on.

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** Classifies an error by the kind of remediation it needs. */
export type ErrorBucket =
  | "transient"
  | "client"
  | "third_party"
  | "business"
  | "data_corruption";

export interface RFC7807Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  error_code: string;
  field_errors?: FieldError[];
}

export abstract class AppError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly error_code: string;
  readonly title: string;
  readonly detail?: string;
  readonly field_errors?: FieldError[];
  readonly cause?: unknown;
  readonly requestId?: string;
  /** The remediation class this error belongs to (Layer 1 taxonomy). */
  readonly bucket?: ErrorBucket;
  /** True when the operation is safe to retry without any other change. */
  readonly isRetryable?: boolean;

  constructor(opts: {
    title: string;
    detail?: string;
    field_errors?: FieldError[];
    cause?: unknown;
    requestId?: string;
    bucket?: ErrorBucket;
    isRetryable?: boolean;
  }) {
    super(opts.detail ?? opts.title);
    this.title = opts.title;
    this.detail = opts.detail;
    this.field_errors = opts.field_errors;
    this.cause = opts.cause;
    this.requestId = opts.requestId;
    this.bucket = opts.bucket;
    this.isRetryable = opts.isRetryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toProblem(): RFC7807Problem {
    return {
      type: `https://docs.fleet.internal/problems/${this.error_code.toLowerCase()}`,
      title: this.title,
      status: this.httpStatus,
      detail: this.detail,
      instance: this.requestId,
      error_code: this.error_code,
      field_errors: this.field_errors,
    };
  }
}

export class ValidationError extends AppError {
  readonly httpStatus = 400;
  readonly error_code = "VALIDATION_ERROR";
  constructor(detail?: string, field_errors?: FieldError[]) {
    super({ title: "Validation failed", detail, field_errors, bucket: "client" });
  }
}

export class Unauthenticated extends AppError {
  readonly httpStatus = 401;
  readonly error_code = "UNAUTHENTICATED";
  constructor(detail = "Authentication required") {
    super({ title: "Unauthenticated", detail, bucket: "client" });
  }
}

export class MfaRequired extends AppError {
  readonly httpStatus = 401;
  readonly error_code = "MFA_REQUIRED";
  constructor(detail = "MFA code required") {
    super({ title: "MFA required", detail, bucket: "client" });
  }
}

export class Forbidden extends AppError {
  readonly httpStatus = 403;
  readonly error_code = "FORBIDDEN";
  constructor(detail = "Insufficient permissions") {
    super({ title: "Forbidden", detail, bucket: "client" });
  }
}

export class AccountSuspended extends AppError {
  readonly httpStatus = 403;
  readonly error_code = "ACCOUNT_SUSPENDED";
  constructor(detail = "Account suspended. Contact Admin.") {
    super({ title: "Account suspended", detail, bucket: "client" });
  }
}

export class DeviceRevoked extends AppError {
  readonly httpStatus = 403;
  readonly error_code = "DEVICE_REVOKED";
  constructor(detail = "Device revoked. Contact Admin.") {
    super({ title: "Device revoked", detail, bucket: "client" });
  }
}

export class ConsentRequired extends AppError {
  readonly httpStatus = 403;
  readonly error_code = "CONSENT_REQUIRED";
  constructor(detail = "GPS tracking consent required") {
    super({ title: "Consent required", detail, bucket: "client" });
  }
}

export class NotFound extends AppError {
  readonly httpStatus = 404;
  readonly error_code = "NOT_FOUND";
  constructor(detail = "Resource not found") {
    super({ title: "Not found", detail, bucket: "client" });
  }
}

export class ConflictError extends AppError {
  readonly httpStatus = 409;
  readonly error_code: string;
  constructor(error_code: string, title: string, detail?: string) {
    super({ title, detail, bucket: "client" });
    this.error_code = error_code;
  }
}

export class SemanticViolation extends AppError {
  readonly httpStatus = 422;
  readonly error_code: string;
  constructor(error_code: string, title: string, detail?: string, field_errors?: FieldError[]) {
    super({ title, detail, field_errors, bucket: "business" });
    this.error_code = error_code;
  }
}

export class IdempotencyConflict extends AppError {
  readonly httpStatus = 422;
  readonly error_code = "IDEMPOTENCY_CONFLICT";
  constructor(detail = "Idempotency-Key reused with a different request body") {
    super({ title: "Idempotency conflict", detail, bucket: "client" });
  }
}

export class QuarantinedMediaError extends AppError {
  readonly httpStatus = 409;
  readonly error_code = "MEDIA_QUARANTINED";
  constructor(detail = "Media is quarantined and cannot be served") {
    super({ title: "Media quarantined", detail, bucket: "business" });
  }
}

export class IdempotencyInFlight extends AppError {
  readonly httpStatus = 409;
  readonly error_code = "IDEMPOTENCY_INFLIGHT";
  constructor(detail = "A previous attempt with this Idempotency-Key is still in progress") {
    super({ title: "Idempotency in flight", detail, bucket: "transient" });
  }
}

export class RateLimited extends AppError {
  readonly httpStatus = 429;
  readonly error_code = "RATE_LIMITED";
  constructor(detail = "Too many attempts, slow down") {
    super({ title: "Rate limited", detail, bucket: "transient" });
  }
}

/** Base transient-error type: a 503 signalling a safe-to-retry, infrastructure-level failure. */
export class TransientError extends AppError {
  readonly httpStatus = 503;
  readonly error_code: string;
  constructor(error_code = "SERVICE_UNAVAILABLE", detail = "Service temporarily unavailable") {
    super({ title: "Service unavailable", detail, bucket: "transient", isRetryable: true });
    this.error_code = error_code;
  }
}

export class ServiceUnavailable extends TransientError {
  readonly error_code = "SERVICE_UNAVAILABLE";
  constructor(detail = "Service temporarily unavailable") {
    super("SERVICE_UNAVAILABLE", detail);
  }
}

/**
 * Maps every known stable `error_code` (08-error-state-model.md §1) to its
 * remediation bucket. Concrete-class codes are taken from the classes above;
 * dynamic ConflictError/SemanticViolation codes are mapped from the catalogue
 * where the bucket is unambiguous.
 */
export const ERROR_CODE_BUCKET: Record<string, ErrorBucket> = Object.freeze({
  // client (4xx, caller fault)
  VALIDATION_ERROR: "client",
  UNAUTHENTICATED: "client",
  MFA_REQUIRED: "client",
  FORBIDDEN: "client",
  ACCOUNT_SUSPENDED: "client",
  DEVICE_REVOKED: "client",
  CONSENT_REQUIRED: "client",
  NOT_FOUND: "client",
  CLOCKOUT_PENDING: "client",
  SHIFT_ALREADY_OPEN: "client",
  UNLOCK_REQUIRED: "client",
  NO_ASSIGNMENT: "client",
  DUPLICATE: "client",
  SESSION_LIMIT: "client",
  IDEMPOTENCY_CONFLICT: "client",
  IDEMPOTENCY_INFLIGHT: "transient",
  OFFLINE_PIN_LOCKED: "client",
  RATE_LIMITED: "transient",
  // business (422 domain violations)
  ODOMETER_DECREASED: "business",
  ODOMETER_DIVERGENCE: "business",
  HOS_REST_BLOCKED: "business",
  MISSING_GAUGE_PAIR: "business",
  DVIR_FAIL_NEEDS_PHOTO: "business",
  DEFECTS_NOT_REVIEWED: "business",
  WORK_PLAN_REQUIRED: "business",
  ONBOARDING_PROFILE_EMPTY: "business",
  ONBOARDING_CONSENT_REQUIRED: "business",
  BACKGROUND_CHECK_ALREADY_CLEARED: "business",
  MEDIA_QUARANTINED: "business",
  // transient (infra, safe to retry)
  SERVICE_UNAVAILABLE: "transient",
});

/** Codes that are transient / safe to retry by nature (consulted by isRetryableError). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "SERVICE_UNAVAILABLE",
    "RATE_LIMITED",
    "IDEMPOTENCY_INFLIGHT",
  ]),
);

/**
 * Returns the bucket for a known `error_code` string, or undefined when unknown.
 * Use this to classify a raw code (e.g. from a log line or wire payload) without
 * constructing the AppError.
 */
export function bucketForErrorCode(code: string): ErrorBucket | undefined {
  return ERROR_CODE_BUCKET[code];
}

// Convenience helpers used by services (mirrors db/seed + openapi Error Codes section).
export const conflict = (code: string, title: string, detail?: string) =>
  new ConflictError(code, title, detail);
export const violation = (
  code: string,
  title: string,
  detail?: string,
  field_errors?: FieldError[],
) => new SemanticViolation(code, title, detail, field_errors);

/**
 * True when `e` is an AppError that is safe to retry — either explicitly flagged
 * `isRetryable` or classified into the `transient` bucket.
 */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof AppError) {
    return e.isRetryable === true || e.bucket === "transient";
  }
  // Plain string code path: consult the retryable-code set.
  if (typeof e === "string") {
    return RETRYABLE_ERROR_CODES.has(e);
  }
  return false;
}
