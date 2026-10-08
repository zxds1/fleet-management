/**
 * Every product-owned constant in one file, so confirming or changing a policy number is a single edit
 * here rather than a hunt through the code. Each entry names the ledger id it came from and where the
 * backend source of truth is, so a reviewer can see whether a number is ours or the server's.
 *
 * Nothing here weakens a safety rule. Where a threshold exists in `system_config`, the server is
 * authoritative at request time and the value below is only the local copy (see `ConfigClient`).
 *
 * `test/policy.test.ts` asserts every entry is used, so a constant cannot silently drift out of the
 * code, and asserts the values that MUST NOT change without a decision.
 */

export interface PolicyEntry<T> {
  /** The ledger entry this number came from. */
  assumption: string;
  /** Why this value, in one line. */
  why: string;
  value: T;
}

const p = <T>(assumption: string, why: string, value: T): PolicyEntry<T> => ({ assumption, why, value });

export const POLICY = {
  /**
   * B-02 — offline PIN. The COUNT comes from `auth.offline_pin_lockout_attempts` and
   * `auth.offline_pin_wipe_attempts`; only the 4-digit shape and the "wipe locally" behaviour are ours.
   */
  pinDigits: p('B-02', 'A 4-digit PIN is what a gloved driver can enter on a moving vehicle.', 4),

  /**
   * B-03 — the offline ceiling. 24 h is the SEEDED value of `auth.device_offline_max_hours`; the app
   * never allows more, and tightens to the server's own `offline_until` when the device is bound.
   */
  offlineWindowHours: p('B-03', 'Matches auth.device_offline_max_hours; the server window is 7 days and the app is stricter.', 24),

  /** B-04 — how long a stuck item keeps being retried before it stays in the Outbox for a person. */
  maxAttempts: p('B-04', 'Six attempts covers a brief outage; beyond that a person should look at it.', 6),

  /** B-04 — the queue backoff floor and ceiling, in milliseconds. */
  retryBaseMs: p('B-04', 'Five seconds is quick enough to feel automatic and slow enough not to hammer.', 5_000),
  retryMaxMs: p('B-04', 'Five minutes: long enough for a dead zone, short enough for a shift.', 300_000),

  /**
   * B-06 — the Mayday hold. Long enough that a pocket press cannot send one, short enough that a
   * screen-reader user can hold it comfortably.
   */
  maydayHoldMs: p('B-06', 'Two seconds: a deliberate press, not a swipe.', 2_000),

  /**
   * B-07 — the photo budget. The server does NOT check size (`MediaUploadSchema` has no size rule), so
   * this is enforced on the device before the bytes leave it.
   */
  mediaMaxBytes: p('B-07', '500 KB is what a weak uplink on the road can carry per photo.', 500 * 1024),
  mediaMaxWidthPx: p('B-07', '1080 px is enough to read an odometer in a photo.', 1080),

  /** B-05 — realtime throttle and the REST poll fallback when the socket is down. */
  realtimeThrottleMs: p('B-05', 'The map ticks about once a second; one refetch per 2 s keeps it cheap.', 2_000),
  pollFallbackMs: p('B-05', 'Fifteen seconds is often enough for a driver to notice.', 15_000),

  /** B-05 — how long a cached list is trusted before a background refetch. */
  cacheTtlMs: p('B-05', 'Ten seconds: fresh enough to feel live, stale enough to survive a dead zone.', 10_000),

  /** B-05 — REST poll interval used while the socket is down. */
  /** B-09 — how many days back the shift review queue opens. */
  reviewQueueDays: p('B-09', 'The inbox endpoint defaults to ALL dates when the params are omitted, so the app must ask.', 1),

  /** B-08 — the page size a badge counts, and how many notification rows the app keeps in memory. */
  badgePageSize: p('B-08', '50 rows: enough for a real badge, small enough to fetch on every focus.', 50),

  /** B-19 — the languages the app ships. The server localises notification copy only. */
  locales: p('B-19', 'en and sw, the languages the drivers actually speak.', ['en', 'sw'] as const),

  diskCacheTtlMs: p('A-04', 'A week: long enough to survive a weekend offline, short enough for GPS.', 7 * 24 * 3_600_000),

  /** A-05 — delivered/rejected queue rows older than this are purged on open. */
  resetAfterDays: p('A-05', 'Ninety days, matching retention.location_raw_days.', 90),

  /** A-04 — how long the persisted query cache is trusted before it is discarded. */
} as const;

/** Convenience accessors, so call sites read as behaviour rather than as numbers. */
export const MAX_ATTEMPTS = POLICY.maxAttempts.value;
export const RETRY_BASE_MS = POLICY.retryBaseMs.value;
export const RETRY_MAX_MS = POLICY.retryMaxMs.value;
export const MAYDAY_HOLD_MS = POLICY.maydayHoldMs.value;
export const MEDIA_MAX_BYTES = POLICY.mediaMaxBytes.value;
export const MEDIA_MAX_WIDTH_PX = POLICY.mediaMaxWidthPx.value;
export const CACHE_TTL_MS = POLICY.cacheTtlMs.value;
export const DISK_CACHE_TTL_MS = POLICY.diskCacheTtlMs.value;
export const REALTIME_THROTTLE_MS = POLICY.realtimeThrottleMs.value;
export const POLL_FALLBACK_MS = POLICY.pollFallbackMs.value;
export const BADGE_PAGE_SIZE = POLICY.badgePageSize.value;
export const RESET_AFTER_DAYS = POLICY.resetAfterDays.value;
export const REVIEW_QUEUE_DAYS = POLICY.reviewQueueDays.value;
export const PIN_DIGITS = POLICY.pinDigits.value;