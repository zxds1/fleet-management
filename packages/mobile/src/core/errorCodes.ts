// packages/mobile/src/core/errorCodes.ts
//
// The frozen `error_code` catalogue (docs/backend/08-error-state-model.md §1) plus the *single
// correct action* each code maps to in the apps (flows.md §D: "ErrorState with error_code mapped to
// localized copy + the single correct action").
//
// Two things are deliberately separated:
//   1. `ErrorAction` — what the UI offers (retry / edit / go online / re-login / contact admin / …).
//   2. `QueueDisposition` — what the offline queue does with a failed replay (D-7):
//        • `discard`        → conflict/duplicate replay, silently dropped with a toast
//        • `retry`          → transient; stays PENDING with exponential backoff
//        • `failed_review`  → hard domain error; kept, surfaced, user edits/retries/discards
//        • `reauth`         → the session is dead; force an online re-login (B13)
//
// Adding a code here is a contract change: `08` §1 says the catalogue is frozen and requires a
// versioned `openapi.yaml` bump. The exhaustive `ERROR_CODES` tuple + `KnownErrorCode` union make a
// missing mapping a compile error.

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "MFA_REQUIRED",
  "FORBIDDEN",
  "ACCOUNT_SUSPENDED",
  "DEVICE_REVOKED",
  "DEVICE_UNKNOWN",
  "CONSENT_REQUIRED",
  "NOT_FOUND",
  "CLOCKOUT_PENDING",
  "SHIFT_ALREADY_OPEN",
  "UNLOCK_REQUIRED",
  "NO_ASSIGNMENT",
  "DUPLICATE",
  "SESSION_LIMIT",
  "IDEMPOTENCY_INFLIGHT",
  "ODOMETER_DECREASED",
  "ODOMETER_DIVERGENCE",
  "HOS_REST_BLOCKED",
  "MISSING_GAUGE_PAIR",
  "DVIR_FAIL_NEEDS_PHOTO",
  "DEFECTS_NOT_REVIEWED",
  "IDEMPOTENCY_CONFLICT",
  "WORK_PLAN_REQUIRED",
  "RATE_LIMITED",
  "OFFLINE_PIN_LOCKED",
  "SERVICE_UNAVAILABLE",
  // Client-side pseudo-codes. They never come from the server; they let the same mapping table
  // drive purely local failures (no connectivity, unparseable payload, media upload failure).
  "NETWORK_UNAVAILABLE",
  "RESPONSE_INVALID",
  "MEDIA_UPLOAD_FAILED",
  "UNKNOWN",
] as const;

export type KnownErrorCode = (typeof ERROR_CODES)[number];

/** The single action the UI offers for a code. `none` = informational only. */
export type ErrorAction =
  | "retry"
  | "edit"
  | "go_online"
  | "relogin"
  | "contact_admin"
  | "register_device"
  | "accept_consent"
  | "enter_mfa"
  | "wait"
  | "unlock_first"
  | "add_photo"
  | "none";

/** What the offline drainer does with this code on replay (D-7). */
export type QueueDisposition = "discard" | "retry" | "failed_review" | "reauth";

export interface ErrorSpec {
  /** i18n key under the `errors.` namespace; en/sw copy lives in `core/i18n/*.json`. */
  messageKey: string;
  action: ErrorAction;
  disposition: QueueDisposition;
  /** True when the code is a hard stop for the whole session, not just one write. */
  fatal: boolean;
}

export const ERROR_SPECS: Record<KnownErrorCode, ErrorSpec> = {
  // 400
  VALIDATION_ERROR: { messageKey: "VALIDATION_ERROR", action: "edit", disposition: "failed_review", fatal: false },

  // 401
  UNAUTHENTICATED: { messageKey: "UNAUTHENTICATED", action: "relogin", disposition: "reauth", fatal: true },
  MFA_REQUIRED: { messageKey: "MFA_REQUIRED", action: "enter_mfa", disposition: "reauth", fatal: false },

  // 403
  FORBIDDEN: { messageKey: "FORBIDDEN", action: "contact_admin", disposition: "failed_review", fatal: false },
  ACCOUNT_SUSPENDED: { messageKey: "ACCOUNT_SUSPENDED", action: "contact_admin", disposition: "reauth", fatal: true },
  DEVICE_REVOKED: { messageKey: "DEVICE_REVOKED", action: "contact_admin", disposition: "reauth", fatal: true },
  DEVICE_UNKNOWN: { messageKey: "DEVICE_UNKNOWN", action: "register_device", disposition: "reauth", fatal: false },
  CONSENT_REQUIRED: { messageKey: "CONSENT_REQUIRED", action: "accept_consent", disposition: "failed_review", fatal: false },

  // 404
  NOT_FOUND: { messageKey: "NOT_FOUND", action: "none", disposition: "failed_review", fatal: false },

  // 409
  CLOCKOUT_PENDING: { messageKey: "CLOCKOUT_PENDING", action: "edit", disposition: "failed_review", fatal: false },
  SHIFT_ALREADY_OPEN: { messageKey: "SHIFT_ALREADY_OPEN", action: "none", disposition: "failed_review", fatal: false },
  UNLOCK_REQUIRED: { messageKey: "UNLOCK_REQUIRED", action: "unlock_first", disposition: "failed_review", fatal: false },
  NO_ASSIGNMENT: { messageKey: "NO_ASSIGNMENT", action: "contact_admin", disposition: "failed_review", fatal: false },
  DUPLICATE: { messageKey: "DUPLICATE", action: "none", disposition: "discard", fatal: false },
  SESSION_LIMIT: { messageKey: "SESSION_LIMIT", action: "relogin", disposition: "reauth", fatal: false },
  // A prior attempt with the same key is still running server-side (01 §5) — back off and retry.
  IDEMPOTENCY_INFLIGHT: { messageKey: "IDEMPOTENCY_INFLIGHT", action: "wait", disposition: "retry", fatal: false },

  // 422
  ODOMETER_DECREASED: { messageKey: "ODOMETER_DECREASED", action: "edit", disposition: "failed_review", fatal: false },
  ODOMETER_DIVERGENCE: { messageKey: "ODOMETER_DIVERGENCE", action: "edit", disposition: "failed_review", fatal: false },
  HOS_REST_BLOCKED: { messageKey: "HOS_REST_BLOCKED", action: "wait", disposition: "failed_review", fatal: false },
  MISSING_GAUGE_PAIR: { messageKey: "MISSING_GAUGE_PAIR", action: "edit", disposition: "failed_review", fatal: false },
  DVIR_FAIL_NEEDS_PHOTO: { messageKey: "DVIR_FAIL_NEEDS_PHOTO", action: "add_photo", disposition: "failed_review", fatal: false },
  DEFECTS_NOT_REVIEWED: { messageKey: "DEFECTS_NOT_REVIEWED", action: "edit", disposition: "failed_review", fatal: false },
  // Same key, different body → the replay is not the write we made. Discard it (D-7).
  IDEMPOTENCY_CONFLICT: { messageKey: "IDEMPOTENCY_CONFLICT", action: "none", disposition: "discard", fatal: false },
  WORK_PLAN_REQUIRED: { messageKey: "WORK_PLAN_REQUIRED", action: "edit", disposition: "failed_review", fatal: false },

  // 429
  RATE_LIMITED: { messageKey: "RATE_LIMITED", action: "wait", disposition: "retry", fatal: false },
  OFFLINE_PIN_LOCKED: { messageKey: "OFFLINE_PIN_LOCKED", action: "wait", disposition: "retry", fatal: false },

  // 503
  SERVICE_UNAVAILABLE: { messageKey: "SERVICE_UNAVAILABLE", action: "retry", disposition: "retry", fatal: false },

  // Client-side
  NETWORK_UNAVAILABLE: { messageKey: "NETWORK_UNAVAILABLE", action: "go_online", disposition: "retry", fatal: false },
  RESPONSE_INVALID: { messageKey: "RESPONSE_INVALID", action: "retry", disposition: "failed_review", fatal: false },
  MEDIA_UPLOAD_FAILED: { messageKey: "MEDIA_UPLOAD_FAILED", action: "retry", disposition: "failed_review", fatal: false },
  UNKNOWN: { messageKey: "UNKNOWN", action: "retry", disposition: "failed_review", fatal: false },
};

/** Narrows an arbitrary server string to a known code, falling back to `UNKNOWN`. */
export function toKnownErrorCode(code: string | undefined | null): KnownErrorCode {
  if (!code) return "UNKNOWN";
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as KnownErrorCode) : "UNKNOWN";
}

export function specFor(code: string | undefined | null): ErrorSpec {
  return ERROR_SPECS[toKnownErrorCode(code)];
}

/** D-7 disposition for a code, used by the offline drainer. */
export function dispositionFor(code: string | undefined | null): QueueDisposition {
  return specFor(code).disposition;
}

/** True when the code must tear the session down (suspended / revoked / unauthenticated). */
export function isFatal(code: string | undefined | null): boolean {
  return specFor(code).fatal;
}
