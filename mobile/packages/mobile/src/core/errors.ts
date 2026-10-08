import { AppError, CLIENT_ERROR_CODES, ERROR_CODE_BUCKET, SERVER_ERROR_CODES, isRetryableErrorCode } from '@fleet/shared';

export type ErrorAction =
  | 'RETRY' | 'EDIT' | 'DISCARD' | 'CONTACT_ADMIN' | 'RELOGIN'
  | 'WAIT' | 'GIVE_CONSENT' | 'MFA'
  | 'OPEN_CLOCKOUT' | 'OPEN_SHIFT' | 'REFRESH' | 'VIEW_FLAGS';

/**
 * Every `error_code` the backend can return, mapped to one i18n key and EXACTLY one action.
 *
 * The key set is the backend's frozen catalogue (`ERROR_CODE_BUCKET` in
 * `fleet-management/packages/shared/src/errors.ts`), not the earlier hand-written list:
 * `DEVICE_UNKNOWN`, `GAUGE_DELTA_HIGH`, `FUEL_PRICE_SPIKE` and `BLOCKER_DEFECT` do NOT exist as error
 * codes — the first was never emitted by any route, the last two are anomaly kinds and `block_shift`
 * is a successful-response field. `test/apiClient.test.ts` fails the build if a server code is
 * missing here or if a code here is not in the server catalogue.
 */
export const ERROR_CATALOG: Record<string, { key: string; action: ErrorAction }> = {
  // ── session / identity ──
  UNAUTHENTICATED:      { key: 'errors.UNAUTHENTICATED', action: 'RELOGIN' },
  SESSION_REVOKED:      { key: 'errors.SESSION_REVOKED', action: 'RELOGIN' },
  SESSION_LIMIT:        { key: 'errors.SESSION_LIMIT', action: 'CONTACT_ADMIN' },
  ACCOUNT_SUSPENDED:    { key: 'errors.ACCOUNT_SUSPENDED', action: 'CONTACT_ADMIN' },
  DEVICE_REVOKED:       { key: 'errors.DEVICE_REVOKED', action: 'CONTACT_ADMIN' },
  IP_BLOCKED:           { key: 'errors.IP_BLOCKED', action: 'WAIT' },
  MFA_REQUIRED:         { key: 'errors.MFA_REQUIRED', action: 'MFA' },
  CONSENT_REQUIRED:     { key: 'errors.CONSENT_REQUIRED', action: 'GIVE_CONSENT' },
  OFFLINE_PIN_LOCKED:   { key: 'errors.OFFLINE_PIN_LOCKED', action: 'WAIT' },

  // ── authorisation / request shape ──
  FORBIDDEN:            { key: 'errors.FORBIDDEN', action: 'CONTACT_ADMIN' },
  NOT_FOUND:            { key: 'errors.NOT_FOUND', action: 'REFRESH' },
  VALIDATION_ERROR:     { key: 'errors.VALIDATION_ERROR', action: 'EDIT' },
  DUPLICATE:            { key: 'errors.DUPLICATE', action: 'EDIT' },
  RATE_LIMITED:         { key: 'errors.RATE_LIMITED', action: 'WAIT' },
  SERVICE_UNAVAILABLE:  { key: 'errors.SERVICE_UNAVAILABLE', action: 'RETRY' },

  // ── idempotency ──
  IDEMPOTENCY_CONFLICT: { key: 'errors.IDEMPOTENCY_CONFLICT', action: 'DISCARD' },
  IDEMPOTENCY_INFLIGHT: { key: 'errors.IDEMPOTENCY_INFLIGHT', action: 'RETRY' },

  // ── shift domain (409 / 422) ──
  CLOCKOUT_PENDING:     { key: 'errors.CLOCKOUT_PENDING', action: 'OPEN_CLOCKOUT' },
  SHIFT_ALREADY_OPEN:   { key: 'errors.SHIFT_ALREADY_OPEN', action: 'OPEN_SHIFT' },
  UNLOCK_REQUIRED:      { key: 'errors.UNLOCK_REQUIRED', action: 'CONTACT_ADMIN' },
  NO_ASSIGNMENT:        { key: 'errors.NO_ASSIGNMENT', action: 'CONTACT_ADMIN' },
  HOS_REST_BLOCKED:     { key: 'errors.HOS_REST_BLOCKED', action: 'WAIT' },
  ODOMETER_DECREASED:   { key: 'errors.ODOMETER_DECREASED', action: 'EDIT' },
  ODOMETER_DIVERGENCE:  { key: 'errors.ODOMETER_DIVERGENCE', action: 'VIEW_FLAGS' },
  WORK_PLAN_REQUIRED:   { key: 'errors.WORK_PLAN_REQUIRED', action: 'EDIT' },

  // ── inspection / fuel domain (422) ──
  DVIR_FAIL_NEEDS_PHOTO: { key: 'errors.DVIR_FAIL_NEEDS_PHOTO', action: 'EDIT' },
  DEFECTS_NOT_REVIEWED: { key: 'errors.DEFECTS_NOT_REVIEWED', action: 'EDIT' },
  MEDIA_QUARANTINED:    { key: 'errors.MEDIA_QUARANTINED', action: 'CONTACT_ADMIN' },

  // ── onboarding domain (422) ──
  ONBOARDING_PROFILE_EMPTY: { key: 'errors.ONBOARDING_PROFILE_EMPTY', action: 'EDIT' },
  ONBOARDING_CONSENT_REQUIRED: { key: 'errors.ONBOARDING_CONSENT_REQUIRED', action: 'GIVE_CONSENT' },
  BACKGROUND_CHECK_ALREADY_CLEARED: { key: 'errors.BACKGROUND_CHECK_ALREADY_CLEARED', action: 'CONTACT_ADMIN' },

  // ── local only (the offline queue invents these; they never come off the wire) ──
  DEPENDENCY_FAILED:    { key: 'errors.DEPENDENCY_FAILED', action: 'DISCARD' },
  UPLOAD_UNAVAILABLE:   { key: 'errors.UPLOAD_UNAVAILABLE', action: 'RETRY' },
  OFFLINE_AUTH_EXPIRED: { key: 'errors.OFFLINE_AUTH_EXPIRED', action: 'RELOGIN' },
};

const UNKNOWN = { key: 'errors.UNKNOWN', action: 'RETRY' as ErrorAction };
export const describeError = (code: string) => ERROR_CATALOG[code] ?? UNKNOWN;

export type QueueOutcome = 'DONE' | 'RETRY_LATER' | 'INFLIGHT_RETRY' | 'DISCARD' | 'FAILED_REVIEW' | 'REFRESH_AUTH';

/**
 * Decides what the offline drainer does with a response. Keyed on `error_code` first (the only
 * branchable member, 08 §1), status second.
 *
 * The backend's statuses are now known, so there is nothing left to guess: `IDEMPOTENCY_INFLIGHT` is
 * 409, `IDEMPOTENCY_CONFLICT` is 422, `RATE_LIMITED` is 429 and everything >= 500 is transient.
 */
export function classifyResponse(status: number, errorCode?: string): QueueOutcome {
  if (status >= 200 && status < 300) return 'DONE';
  // Only IDEMPOTENCY_INFLIGHT is retried on a 409: CLOCKOUT_PENDING / SHIFT_ALREADY_OPEN /
  // UNLOCK_REQUIRED are also 409 and are hard domain outcomes that need a person.
  if (errorCode === 'IDEMPOTENCY_INFLIGHT') return 'INFLIGHT_RETRY';
  if (errorCode === 'IDEMPOTENCY_CONFLICT' || errorCode === 'DUPLICATE') return 'DISCARD';
  if (status === 401) return 'REFRESH_AUTH';
  if ((errorCode !== undefined && isRetryableErrorCode(errorCode)) || status === 429 || status === 408 || status >= 500) return 'RETRY_LATER';
  return 'FAILED_REVIEW';   // other 4xx are never silently dropped
}

/** True when the server can be asked again with the same request. */
export const isRetryable = (status: number, errorCode?: string): boolean =>
  status === 429 || status === 408 || status >= 500 || (errorCode !== undefined && isRetryableErrorCode(errorCode));

/**
 * The signal vocabulary the backend can send inside `open_anomalies` / a fuel row, plus the
 * `block_shift` flag on a successful inspection. These are NOT error codes: they are shown as
 * information next to a save that worked, never as a failure.
 */
export const SIGNAL_CATALOG: Record<string, string> = {
  FUEL_ANOMALY_CRITICAL: 'signals.fuelAnomalyCritical',
  GAUGE_DELTA_HIGH: 'signals.gaugeDeltaHigh',
  FUEL_PRICE_SPIKE: 'signals.fuelPriceSpike',
  BLOCKER_DEFECT: 'signals.blockerDefect',
  OFF_SHIFT_MOVEMENT: 'signals.offShiftMovement',
  TRACKER_OFFLINE: 'signals.trackerOffline',
};
export const signalKey = (kind: string): string => SIGNAL_CATALOG[kind] ?? 'signals.unknown';

/** Maps a thrown error to { fieldPath: message } so forms show the server's complaint on the right input. */
export function fieldErrorMap(e: unknown, t: (k: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof AppError) {
    for (const f of e.field_errors ?? []) {
      const key = `errors.${f.code}`;
      const local = t(key);
      out[f.field] = local !== key ? local : f.message;
    }
  } else if (e && typeof e === 'object' && Array.isArray((e as { issues?: unknown }).issues)) {
    for (const i of (e as { issues: { path: (string | number)[]; message: string }[] }).issues) {
      const k = i.path.join('.');
      if (k && !(k in out)) out[k] = i.message;
    }
  }
  return out;
}

/** Exported so a test can prove the client catalogue covers the server catalogue exactly. */
export const COVERED_SERVER_CODES = SERVER_ERROR_CODES.filter((c) => c in ERROR_CATALOG);
export const MISSING_SERVER_CODES = SERVER_ERROR_CODES.filter((c) => !(c in ERROR_CATALOG));
export const EXTRA_CATALOG_CODES = Object.keys(ERROR_CATALOG).filter((c) => !SERVER_ERROR_CODES.includes(c));
export const CLIENT_ONLY_CODES: readonly string[] = CLIENT_ERROR_CODES;
export { ERROR_CODE_BUCKET };