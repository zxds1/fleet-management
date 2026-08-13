package com.fleetpulse.app.data.remote

/**
 * Normalized backend problem (RFC7807, packages/shared/src/errors.ts). The app branches ONLY on
 * [errorCode]. Mirrors the ERROR_CODE_BUCKET classification in packages/shared/src/errors.ts.
 */
data class AppException(
    val errorCode: String,
    val title: String? = null,
    val detail: String? = null,
    val status: Int? = null,
    val requestId: String? = null,
    val fieldErrors: List<FieldError> = emptyList(),
    val bucket: ErrorBucket = ErrorBucket.CLIENT,
    val isRetryable: Boolean = false,
) : Exception(detail ?: title ?: errorCode) {

    val isTransient: Boolean get() = bucket == ErrorBucket.TRANSIENT
    val isBusiness: Boolean get() = bucket == ErrorBucket.BUSINESS

    /** True when the write should be parked in FAILED_REVIEW (editable) vs discarded. */
    val shouldDiscard: Boolean get() = errorCode == "IDEMPOTENCY_CONFLICT" || errorCode == "DUPLICATE"

    companion object {
        fun fromErrorCode(code: String, detail: String? = null): AppException {
            val bucket = when (code) {
                "SERVICE_UNAVAILABLE", "RATE_LIMITED", "IDEMPOTENCY_INFLIGHT" -> ErrorBucket.TRANSIENT
                "ODOMETER_DECREASED", "ODOMETER_DIVERGENCE", "HOS_REST_BLOCKED", "MISSING_GAUGE_PAIR",
                "DVIR_FAIL_NEEDS_PHOTO", "DEFECTS_NOT_REVIEWED", "WORK_PLAN_REQUIRED",
                "ONBOARDING_PROFILE_EMPTY", "ONBOARDING_CONSENT_REQUIRED",
                "BACKGROUND_CHECK_ALREADY_CLEARED", "MEDIA_QUARANTINED" -> ErrorBucket.BUSINESS
                else -> ErrorBucket.CLIENT
            }
            return AppException(
                errorCode = code,
                detail = detail,
                bucket = bucket,
                isRetryable = code in setOf("SERVICE_UNAVAILABLE", "RATE_LIMITED", "IDEMPOTENCY_INFLIGHT"),
            )
        }
    }
}

data class FieldError(val field: String, val code: String, val message: String)

enum class ErrorBucket { TRANSIENT, CLIENT, BUSINESS, DATA_CORRUPTION, THIRD_PARTY }

/** Thrown when a transport-level failure means the write may or may not have landed. */
class NetworkException(message: String, val requestId: String? = null) : Exception(message)

/** Thrown when the circuit breaker is open (fail-fast). */
class CircuitOpenException(host: String, val retryAfterMs: Long) :
    Exception("network circuit open for $host; retry in ${retryAfterMs / 1000}s")
