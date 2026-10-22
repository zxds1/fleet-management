/// The client's copy of the backend's frozen error catalogue (RFC7807 bodies;
/// branch on `error_code` only — never on `title`/`detail`).
enum ErrorAction {
  retry,
  edit,
  discard,
  contactAdmin,
  relogin,
  wait,
  giveConsent,
  mfa,
  openClockout,
  openShift,
  refresh,
  viewFlags,
}

/// The dictionary spells the action labels in SCREAMING_CASE, the enum names
/// are camelCase — this is the bridge.
extension ErrorActionLabel on ErrorAction {
  String get labelKey => switch (this) {
        ErrorAction.retry => 'actions.RETRY',
        ErrorAction.edit => 'actions.EDIT',
        ErrorAction.discard => 'actions.DISCARD',
        ErrorAction.contactAdmin => 'actions.CONTACT_ADMIN',
        ErrorAction.relogin => 'actions.RELOGIN',
        ErrorAction.wait => 'actions.WAIT',
        ErrorAction.giveConsent => 'actions.GIVE_CONSENT',
        ErrorAction.mfa => 'actions.MFA',
        ErrorAction.openClockout => 'actions.OPEN_CLOCKOUT',
        ErrorAction.openShift => 'actions.OPEN_SHIFT',
        ErrorAction.refresh => 'actions.REFRESH',
        ErrorAction.viewFlags => 'actions.VIEW_FLAGS',
      };
}

class CatalogueEntry {
  const CatalogueEntry(this.i18nKey, this.action, {this.retryable = false});
  final String i18nKey;
  final ErrorAction action;
  final bool retryable;
}

class HelixError implements Exception {
  HelixError({
    required this.code,
    required this.status,
    this.detail,
    this.fieldErrors = const {},
    this.retryAfterSeconds,
    this.challengeToken,
  });

  final String code;
  final int status;
  final String? detail;
  final Map<String, String> fieldErrors;
  final int? retryAfterSeconds;

  /// MFA challenge token handed out by a sign-in; carried to the verify call.
  final String? challengeToken;

  bool get isNetwork => code == 'NETWORK';
  bool get isOfflineAuth => code == 'OFFLINE_AUTH_EXPIRED';

  static const String networkCode = 'NETWORK';
  static const String unknownCode = 'TRANSACTION_FAILED';

  factory HelixError.network() => HelixError(code: networkCode, status: 0);

  static HelixError fromProblem(Map<String, dynamic> body, int status) {
    final code = (body['error_code'] as String?) ?? unknownCode;
    final fields = <String, String>{};
    final raw = body['field_errors'];
    if (raw is List) {
      for (final f in raw) {
        if (f is Map) {
          final path = f['field']?.toString();
          if (path != null) fields[path] = f['message']?.toString() ?? '';
        }
      }
    }
    final retryAfter = body['retry_after_seconds'];
    final challenge = body['mfa_challenge_token'] ?? body['challenge_token'];
    return HelixError(
      code: code,
      status: status,
      detail: body['detail']?.toString(),
      fieldErrors: fields,
      retryAfterSeconds: retryAfter is int ? retryAfter : null,
      challengeToken: challenge?.toString(),
    );
  }

  CatalogueEntry get catalogue => ERROR_CATALOG[code] ?? ERROR_CATALOG[unknownCode]!;

  /// Error-code-first classification, then status class.
  bool get isRetryable {
    final entry = ERROR_CATALOG[code];
    if (entry != null && code != unknownCode) return entry.retryable;
    // An unknown code — or a server body that carried no code at all — is
    // classified by status: a 4xx is a permanent business failure, a 5xx is
    // worth another attempt.
    return status >= 500 || status == 408 || status == 429;
  }
}

// The catalogue is intentionally SCREAMING_SNAKE (frozen contract names, mirrors @fleet/shared).
// ignore: constant_identifier_names
const Map<String, CatalogueEntry> ERROR_CATALOG = {
  // session / identity
  'UNAUTHENTICATED': CatalogueEntry('errors.UNAUTHENTICATED', ErrorAction.relogin),
  'SESSION_REVOKED': CatalogueEntry('errors.SESSION_REVOKED', ErrorAction.relogin),
  'SESSION_LIMIT': CatalogueEntry('errors.SESSION_LIMIT', ErrorAction.contactAdmin),
  'ACCOUNT_SUSPENDED': CatalogueEntry('errors.ACCOUNT_SUSPENDED', ErrorAction.contactAdmin),
  'DEVICE_REVOKED': CatalogueEntry('errors.DEVICE_REVOKED', ErrorAction.contactAdmin),
  'IP_BLOCKED': CatalogueEntry('errors.IP_BLOCKED', ErrorAction.wait),
  'MFA_REQUIRED': CatalogueEntry('errors.MFA_REQUIRED', ErrorAction.mfa),
  'NO_MFA_CHALLENGE': CatalogueEntry('errors.NO_MFA_CHALLENGE', ErrorAction.relogin),
  'MFA_VERIFY_FAILED': CatalogueEntry('errors.MFA_VERIFY_FAILED', ErrorAction.mfa),
  'SIGN_IN_NO_SESSION': CatalogueEntry('errors.SIGN_IN_NO_SESSION', ErrorAction.relogin),
  'CONSENT_REQUIRED': CatalogueEntry('errors.CONSENT_REQUIRED', ErrorAction.giveConsent),
  'OFFLINE_PIN_LOCKED': CatalogueEntry('errors.OFFLINE_PIN_LOCKED', ErrorAction.wait),
  // shape
  'FORBIDDEN': CatalogueEntry('errors.FORBIDDEN', ErrorAction.contactAdmin),
  'NOT_FOUND': CatalogueEntry('errors.NOT_FOUND', ErrorAction.refresh),
  'VALIDATION_ERROR': CatalogueEntry('errors.VALIDATION_ERROR', ErrorAction.edit),
  'DUPLICATE': CatalogueEntry('errors.DUPLICATE', ErrorAction.edit),
  'RATE_LIMITED': CatalogueEntry('errors.RATE_LIMITED', ErrorAction.wait, retryable: true),
  'SERVICE_UNAVAILABLE': CatalogueEntry('errors.SERVICE_UNAVAILABLE', ErrorAction.retry, retryable: true),
  // idempotency
  'IDEMPOTENCY_CONFLICT': CatalogueEntry('errors.IDEMPOTENCY_CONFLICT', ErrorAction.discard),
  'IDEMPOTENCY_INFLIGHT': CatalogueEntry('errors.IDEMPOTENCY_INFLIGHT', ErrorAction.retry, retryable: true),
  // shift domain
  'CLOCKOUT_PENDING': CatalogueEntry('errors.CLOCKOUT_PENDING', ErrorAction.openClockout),
  'SHIFT_ALREADY_OPEN': CatalogueEntry('errors.SHIFT_ALREADY_OPEN', ErrorAction.openShift),
  'UNLOCK_REQUIRED': CatalogueEntry('errors.UNLOCK_REQUIRED', ErrorAction.contactAdmin),
  'NO_ASSIGNMENT': CatalogueEntry('errors.NO_ASSIGNMENT', ErrorAction.contactAdmin),
  'HOS_REST_BLOCKED': CatalogueEntry('errors.HOS_REST_BLOCKED', ErrorAction.wait),
  'ODOMETER_DECREASED': CatalogueEntry('errors.ODOMETER_DECREASED', ErrorAction.edit),
  'ODOMETER_DIVERGENCE': CatalogueEntry('errors.ODOMETER_DIVERGENCE', ErrorAction.viewFlags),
  'WORK_PLAN_REQUIRED': CatalogueEntry('errors.WORK_PLAN_REQUIRED', ErrorAction.edit),
  // inspection / fuel / onboarding
  'DVIR_FAIL_NEEDS_PHOTO': CatalogueEntry('errors.DVIR_FAIL_NEEDS_PHOTO', ErrorAction.edit),
  'DEFECTS_NOT_REVIEWED': CatalogueEntry('errors.DEFECTS_NOT_REVIEWED', ErrorAction.edit),
  'MEDIA_QUARANTINED': CatalogueEntry('errors.MEDIA_QUARANTINED', ErrorAction.contactAdmin),
  'ONBOARDING_PROFILE_EMPTY': CatalogueEntry('errors.ONBOARDING_PROFILE_EMPTY', ErrorAction.edit),
  'ONBOARDING_CONSENT_REQUIRED': CatalogueEntry('errors.ONBOARDING_CONSENT_REQUIRED', ErrorAction.giveConsent),
  'BACKGROUND_CHECK_ALREADY_CLEARED': CatalogueEntry('errors.BACKGROUND_CHECK_ALREADY_CLEARED', ErrorAction.contactAdmin),
  // business conflicts — permanent, never re-queued
  'ALREADY_REJECTED': CatalogueEntry('errors.ALREADY_REJECTED', ErrorAction.contactAdmin),
  'ALREADY_VERIFIED': CatalogueEntry('errors.ALREADY_VERIFIED', ErrorAction.contactAdmin),
  'DRIVER_ALREADY_ACTIVE': CatalogueEntry('errors.DRIVER_ALREADY_ACTIVE', ErrorAction.openShift),
  'EMAIL_TAKEN': CatalogueEntry('errors.EMAIL_TAKEN', ErrorAction.edit),
  'CONFIG_VALUE_INVALID': CatalogueEntry('errors.CONFIG_VALUE_INVALID', ErrorAction.edit),
  'CONFIG_VALUE_OUT_OF_RANGE': CatalogueEntry('errors.CONFIG_VALUE_OUT_OF_RANGE', ErrorAction.edit),
  'VEHICLE_ISSUE_DESCRIPTION_REQUIRED': CatalogueEntry('errors.VEHICLE_ISSUE_DESCRIPTION_REQUIRED', ErrorAction.edit),
  'NOTIFICATION_NOT_FOUND': CatalogueEntry('errors.NOTIFICATION_NOT_FOUND', ErrorAction.refresh),
  // server fallback + local-only codes (never on the wire)
  'TRANSACTION_FAILED': CatalogueEntry('errors.TRANSACTION_FAILED', ErrorAction.contactAdmin),
  'DEPENDENCY_FAILED': CatalogueEntry('errors.DEPENDENCY_FAILED', ErrorAction.discard),
  'UPLOAD_UNAVAILABLE': CatalogueEntry('errors.UPLOAD_UNAVAILABLE', ErrorAction.retry, retryable: true),
  'OFFLINE_AUTH_EXPIRED': CatalogueEntry('errors.OFFLINE_AUTH_EXPIRED', ErrorAction.relogin),
  HelixError.networkCode: CatalogueEntry('errors.NETWORK', ErrorAction.retry, retryable: true),
};

/// Informational signals shown beside a SUCCESSFUL save — not errors.
// ignore: constant_identifier_names
const List<String> SIGNAL_CODES = [
  'FUEL_ANOMALY_CRITICAL',
  'GAUGE_DELTA_HIGH',
  'FUEL_PRICE_SPIKE',
  'BLOCKER_DEFECT',
  'OFF_SHIFT_MOVEMENT',
  'TRACKER_OFFLINE',
];
