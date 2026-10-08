/**
 * RFC 7807 error model, mirrored from the backend's `packages/shared/src/errors.ts`
 * (fleet-management). `error_code` is the ONLY member the client branches on.
 *
 * The catalogue below is the backend's frozen set (08-error-state-model.md §1 / `ERROR_CODE_BUCKET`).
 * Nothing here is invented: a code the backend cannot return is not listed, and a code the backend
 * can return that is missing is a bug caught by `test/contract.test.ts`.
 */

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** How a failure must be remediated (backend Layer 1 taxonomy, 08 §1). */
export type ErrorBucket = 'transient' | 'client' | 'third_party' | 'business' | 'data_corruption';

export interface RFC7807Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  error_code: string;
  field_errors?: FieldError[];
}

export interface AppErrorOptions {
  title: string;
  detail?: string;
  field_errors?: FieldError[];
  requestId?: string;
  bucket?: ErrorBucket;
  isRetryable?: boolean;
}

/**
 * Base of the client-visible error hierarchy. `httpStatus` and `error_code` are the two things the
 * transport and the screens read; everything else is diagnostic.
 */
export abstract class AppError extends Error {
  abstract readonly httpStatus: number;
  abstract readonly error_code: string;
  readonly title: string;
  readonly detail?: string;
  readonly field_errors?: FieldError[];
  readonly requestId?: string;
  readonly bucket: ErrorBucket;
  readonly isRetryable: boolean;

  constructor(opts: AppErrorOptions) {
    super(opts.detail ?? opts.title);
    this.name = new.target.name;
    this.title = opts.title;
    this.detail = opts.detail;
    this.field_errors = opts.field_errors;
    this.requestId = opts.requestId;
    this.bucket = opts.bucket ?? 'client';
    this.isRetryable = opts.isRetryable ?? this.bucket === 'transient';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** The `status` the app reads everywhere; the wire member is `httpStatus`. */
  get status(): number {
    return this.httpStatus;
  }

  /** RFC 7807 member name, so a parsed error round-trips with the body it came from. */
  get instance(): string | undefined {
    return this.requestId;
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

/** Concrete error for a code the server sent on the wire (including dynamic 409/422 codes). */
export class ClientProblemError extends AppError {
  constructor(
    readonly httpStatus: number,
    readonly error_code: string,
    title: string,
    detail?: string,
    field_errors?: FieldError[],
    requestId?: string,
  ) {
    super({ title, detail, field_errors, requestId, bucket: bucketForErrorCode(error_code) ?? 'client', isRetryable: RETRYABLE_ERROR_CODES.has(error_code) });
  }
}

export class ValidationError extends ClientProblemError {
  constructor(detail?: string, field_errors?: FieldError[], requestId?: string) {
    super(400, 'VALIDATION_ERROR', 'Validation failed', detail, field_errors, requestId);
  }
}

export class Unauthenticated extends ClientProblemError {
  constructor(detail = 'Authentication required', requestId?: string) {
    super(401, 'UNAUTHENTICATED', 'Unauthenticated', detail, undefined, requestId);
  }
}

export class MfaRequired extends ClientProblemError {
  constructor(detail = 'MFA code required', requestId?: string) {
    super(401, 'MFA_REQUIRED', 'MFA required', detail, undefined, requestId);
  }
}

export class SessionRevoked extends ClientProblemError {
  constructor(detail = 'Session revoked. Please sign in again.', requestId?: string) {
    super(401, 'SESSION_REVOKED', 'Session revoked', detail, undefined, requestId);
  }
}

export class Forbidden extends ClientProblemError {
  constructor(detail = 'Insufficient permissions', requestId?: string) {
    super(403, 'FORBIDDEN', 'Forbidden', detail, undefined, requestId);
  }
}

export class AccountSuspended extends ClientProblemError {
  constructor(detail = 'Account suspended. Contact Admin.', requestId?: string) {
    super(403, 'ACCOUNT_SUSPENDED', 'Account suspended', detail, undefined, requestId);
  }
}

export class DeviceRevoked extends ClientProblemError {
  constructor(detail = 'Device revoked. Contact Admin.', requestId?: string) {
    super(403, 'DEVICE_REVOKED', 'Device revoked', detail, undefined, requestId);
  }
}

export class IpBlocked extends ClientProblemError {
  constructor(detail = 'Access temporarily blocked from this address', requestId?: string) {
    super(403, 'IP_BLOCKED', 'Forbidden', detail, undefined, requestId);
  }
}

export class ConsentRequired extends ClientProblemError {
  constructor(detail = 'GPS tracking consent required', requestId?: string) {
    super(403, 'CONSENT_REQUIRED', 'Consent required', detail, undefined, requestId);
  }
}

export class NotFound extends ClientProblemError {
  constructor(detail = 'Resource not found', requestId?: string) {
    super(404, 'NOT_FOUND', 'Not found', detail, undefined, requestId);
  }
}

export class ConflictError extends ClientProblemError {
  constructor(error_code: string, title: string, detail?: string, requestId?: string) {
    super(409, error_code, title, detail, undefined, requestId);
  }
}

export class IdempotencyConflict extends ClientProblemError {
  constructor(detail = 'Idempotency-Key reused with a different request body', requestId?: string) {
    super(422, 'IDEMPOTENCY_CONFLICT', 'Idempotency conflict', detail, undefined, requestId);
  }
}

export class SemanticViolation extends ClientProblemError {
  constructor(
    error_code: string,
    title: string,
    detail?: string,
    field_errors?: FieldError[],
    requestId?: string,
  ) {
    super(422, error_code, title, detail, field_errors, requestId);
  }
}

export class MediaQuarantinedError extends ClientProblemError {
  constructor(detail = 'Media is quarantined and cannot be served', requestId?: string) {
    super(409, 'MEDIA_QUARANTINED', 'Media quarantined', detail, undefined, requestId);
  }
}

export class IdempotencyInFlight extends ClientProblemError {
  constructor(detail = 'A previous attempt with this Idempotency-Key is still in progress', requestId?: string) {
    super(409, 'IDEMPOTENCY_INFLIGHT', 'Idempotency in flight', detail, undefined, requestId);
  }
}

export class RateLimited extends ClientProblemError {
  constructor(detail = 'Too many attempts, slow down', requestId?: string) {
    super(429, 'RATE_LIMITED', 'Rate limited', detail, undefined, requestId);
  }
}

export class ServiceUnavailable extends ClientProblemError {
  constructor(detail = 'Service temporarily unavailable', error_code = 'SERVICE_UNAVAILABLE', requestId?: string) {
    super(503, error_code, 'Service unavailable', detail, undefined, requestId);
  }
}

/**
 * Every stable `error_code` the backend can return, and the bucket it belongs to. Copied verbatim
 * from `fleet-management/packages/shared/src/errors.ts` (`ERROR_CODE_BUCKET`) so the client's copy
 * and the server's can never disagree about whether a failure is safe to retry.
 */
export const ERROR_CODE_BUCKET: Readonly<Record<string, ErrorBucket>> = Object.freeze({
  // client (4xx, caller fault)
  VALIDATION_ERROR: 'client',
  UNAUTHENTICATED: 'client',
  MFA_REQUIRED: 'client',
  FORBIDDEN: 'client',
  ACCOUNT_SUSPENDED: 'client',
  DEVICE_REVOKED: 'client',
  IP_BLOCKED: 'client',
  SESSION_REVOKED: 'client',
  CONSENT_REQUIRED: 'client',
  NOT_FOUND: 'client',
  CLOCKOUT_PENDING: 'client',
  SHIFT_ALREADY_OPEN: 'client',
  UNLOCK_REQUIRED: 'client',
  NO_ASSIGNMENT: 'client',
  DUPLICATE: 'client',
  SESSION_LIMIT: 'client',
  IDEMPOTENCY_CONFLICT: 'client',
  OFFLINE_PIN_LOCKED: 'client',
  // transient (safe to retry)
  IDEMPOTENCY_INFLIGHT: 'transient',
  RATE_LIMITED: 'transient',
  SERVICE_UNAVAILABLE: 'transient',
  // business (422 domain violations)
  ODOMETER_DECREASED: 'business',
  ODOMETER_DIVERGENCE: 'business',
  HOS_REST_BLOCKED: 'business',
  DVIR_FAIL_NEEDS_PHOTO: 'business',
  DEFECTS_NOT_REVIEWED: 'business',
  WORK_PLAN_REQUIRED: 'business',
  ONBOARDING_PROFILE_EMPTY: 'business',
  ONBOARDING_CONSENT_REQUIRED: 'business',
  BACKGROUND_CHECK_ALREADY_CLEARED: 'business',
  MEDIA_QUARANTINED: 'business',
});

/** Codes that are transient / safe to retry by nature. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = Object.freeze(
  new Set<string>(['SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'IDEMPOTENCY_INFLIGHT']),
);

export function bucketForErrorCode(code: string): ErrorBucket | undefined {
  return ERROR_CODE_BUCKET[code];
}

/** True when retrying the same request, unchanged, is safe. */
export function isRetryableErrorCode(code: string): boolean {
  return RETRYABLE_ERROR_CODES.has(code) || ERROR_CODE_BUCKET[code] === 'transient';
}

/**
 * The codes this app can be shown. Every server code must either appear here (with copy and exactly
 * one action, see the app's `src/core/errors.ts`) or be handled as `UNKNOWN`; `test/contract.test.ts`
 * fails the build if the two sets drift.
 */
export const SERVER_ERROR_CODES = Object.keys(ERROR_CODE_BUCKET).sort();

/** Local-only codes the offline queue invents. They never come off the wire. */
export const CLIENT_ERROR_CODES = ['DEPENDENCY_FAILED', 'UPLOAD_UNAVAILABLE', 'OFFLINE_AUTH_EXPIRED'] as const;

export const ERROR_CODES: readonly string[] = Object.freeze([...SERVER_ERROR_CODES, ...CLIENT_ERROR_CODES]);

/** Thrown when `fetch` itself fails (offline, DNS, TLS pin failure). Writes get queued on this. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('NETWORK_ERROR');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/** Parses an RFC 7807 body into the matching error. Tolerates anything (HTML from a proxy, empty body). */
export function parseProblem(status: number, body: unknown): AppError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.error_code === 'string' && b.error_code.length > 0 ? b.error_code : 'UNKNOWN';
  const title = typeof b.title === 'string' ? b.title : `HTTP ${status}`;
  const detail = typeof b.detail === 'string' ? b.detail : undefined;
  const fields = Array.isArray(b.field_errors) ? (b.field_errors as FieldError[]) : undefined;
  const instance = typeof b.instance === 'string' ? b.instance : undefined;
  return new ClientProblemError(status, code, title, detail, fields, instance);
}