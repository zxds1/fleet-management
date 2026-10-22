import '../core/api_client.dart';
import '../core/errors.dart';
import '../core/ids.dart';
import '../core/policy.dart';
import '../design/components/paged_list.dart';

/// One data layer for the whole app. Domain methods over the ApiClient; cursor
/// pagination everywhere (the server is keyset-only). Thin models wrap the
/// rows the screens actually read.
class Repository {
  Repository(this._api);
  final ApiClient _api;

  Future<CursorPage<Map<String, dynamic>>> page(
    String path, {
    String? cursor,
    Map<String, dynamic> query = const {},
  }) async {
    final body = await _api.get<Map<String, dynamic>>(
      path,
      query: {'limit': Policy.listPageSize, 'cursor': ?cursor, ...query},
      parse: (b) => (b as Map<String, dynamic>),
    );
    return CursorPage(
      data: (body['data'] as List?)?.cast<Map<String, dynamic>>() ?? const [],
      nextCursor: body['next_cursor'] as String?,
      hasMore: body['has_more'] == true,
    );
  }

  /// A cursor-enveloped list. The server answers `{data, next_cursor,
  /// has_more}` — a bare array is still accepted for the few routes that
  /// answer one.
  Future<List<Map<String, dynamic>>> rawList(String path, {Map<String, dynamic> query = const {}}) async {
    final body = await _api.get<dynamic>(path, query: query, parse: (b) => b);
    if (body is List) return body.cast<Map<String, dynamic>>();
    if (body is Map<String, dynamic>) {
      final data = body['data'];
      if (data is List) return data.cast<Map<String, dynamic>>();
    }
    return const [];
  }

  // ── driver self ──
  Future<Map<String, dynamic>> myOnboarding() =>
      _api.get('drivers/me/onboarding', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>?> saveOnboarding(Map<String, dynamic> body) => _api.write(
        'POST',
        'drivers/me/onboarding/profile',
        body: body,
        parse: (b) => b as Map<String, dynamic>,
      );

  Future<Map<String, dynamic>?> myAssignment() async {
    try {
      return await _api.get('drivers/me/assignment', parse: (b) => b as Map<String, dynamic>);
    } on HelixError catch (e) {
      if (e.code == 'NO_ASSIGNMENT') return null; // 404 NO_ASSIGNMENT is a state, not an error
      rethrow;
    }
  }

  Future<Map<String, dynamic>> myTrainingStatus() =>
      _api.get('drivers/me/training-status', parse: (b) => b as Map<String, dynamic>);

  // ── shifts ──
  Future<Map<String, dynamic>?> activeShift() async {
    final body = await _api.get<dynamic>('shifts/me/active', parse: (b) => b);
    if (body == null) return null;
    if (body is Map<String, dynamic>) return body;
    return null;
  }

  Future<Map<String, dynamic>> clockIn(Map<String, dynamic> body) =>
      _api.write('POST', 'shifts/clock-in', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> clockOut(Map<String, dynamic> body) =>
      _api.write('POST', 'shifts/clock-out', body: body, parse: (b) => b as Map<String, dynamic>);

  // ── fuel ──
  Future<Map<String, dynamic>> fuelCards({String? vehicleId}) async {
    final body = await _api.get<Map<String, dynamic>>(
      'fuel/cards',
      query: {'vehicle_id': ?vehicleId},
      parse: (b) => b as Map<String, dynamic>,
    );
    return body;
  }

  Future<Map<String, dynamic>> submitRefuel(Map<String, dynamic> body) =>
      _api.write('POST', 'driver/fuel/purchase', body: body, parse: (b) => b as Map<String, dynamic>);

  // ── inspections ──
  Future<List<Map<String, dynamic>>> templates() async {
    final body = await _api.get<Map<String, dynamic>>('inspections/templates', parse: (b) => b as Map<String, dynamic>);
    return (body['templates'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  }

  Future<Map<String, dynamic>> submitInspection(Map<String, dynamic> body) =>
      _api.write('POST', 'inspections', body: body, parse: (b) => b as Map<String, dynamic>);

  // ── trailer / vehicles ──
  Future<List<Map<String, dynamic>>> trailers({String? trailerType}) async {
    final body = await _api.get<Map<String, dynamic>>(
      'trailer',
      query: {'trailer_type': ?trailerType},
      parse: (b) => b as Map<String, dynamic>,
    );
    return (body['trailers'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  }

  Future<Map<String, dynamic>> trailerSwap(Map<String, dynamic> body) =>
      _api.write('POST', 'trailer/swap', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<List<Map<String, dynamic>>> vehicleStates() async {
    final body = await _api.get<Map<String, dynamic>>('dashboard/vehicle-states', parse: (b) => b as Map<String, dynamic>);
    return (body['vehicles'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
  }

  // ── accidents ──
  Future<Map<String, dynamic>> mayday(Map<String, dynamic> body) =>
      _api.write('POST', 'accidents/mayday', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> submitAccident(Map<String, dynamic> body) =>
      _api.write('POST', 'accidents', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> accidentMedia(String accidentId, Map<String, dynamic> body) =>
      _api.write('POST', 'accidents/${_requireUuid(accidentId)}/media', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> accident(String accidentId) =>
      _api.get('accidents/${_requireUuid(accidentId)}', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> acknowledgeAccident(String accidentId) =>
      _api.write('POST', 'accidents/${_requireUuid(accidentId)}/acknowledge', body: const {}, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> verifyTelemetry(String accidentId) =>
      _api.get('accidents/${_requireUuid(accidentId)}/telemetry/verify', parse: (b) => b as Map<String, dynamic>);

  /// The caller's own accidents.
  ///
  /// The route validates the query with `CursorQuerySchema`, which strips
  /// `own_scope`: there is no tenant-wide accident list on the API yet, so an
  /// admin calling this sees only their own accidents. A fleet-wide list needs
  /// a backend route (an admin accidents endpoint) before the app can offer
  /// one.
  Future<CursorPage<Map<String, dynamic>>> accidents({required bool ownScope, String? cursor}) =>
      page('accidents/me', cursor: cursor);

  // ── notifications / anomalies / docs ──
  Future<Map<String, dynamic>> notificationCount() =>
      _api.get('notifications/count', parse: (b) => b as Map<String, dynamic>);

  Future<void> markRead(String id) =>
      _api.write('POST', 'notifications/${_requireUuid(id)}/read', body: const {}, parse: (b) => b);

  Future<void> markAllRead() => _api.write('POST', 'notifications/read-all', body: const {}, parse: (b) => b);

  Future<Map<String, dynamic>> anomaly(String id) =>
      _api.get('anomalies/$id', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> document(String id) =>
      _api.get('documents/$id', parse: (b) => b as Map<String, dynamic>);

  Future<void> renewalNote(String id, String note) =>
      _api.write('POST', 'documents/$id/renewal-note', body: {'note': note}, parse: (b) => b);

  // ── admin ──
  Future<Map<String, dynamic>> analytics() =>
      _api.get('reports/analytics', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> adminFuelPending() async {
    final body = await _api.get<Map<String, dynamic>>('admin/fuel/pending', parse: (b) => b as Map<String, dynamic>);
    return body;
  }

  Future<Map<String, dynamic>> verifyFuel(String purchaseId, Map<String, dynamic> body) =>
      _api.write('POST', 'fuel/purchases/$purchaseId/verify', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> verifyShift(String shiftId, Map<String, dynamic> body) =>
      _api.write('POST', 'shifts/$shiftId/verify', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> shift(String shiftId) =>
      _api.get('shifts/$shiftId/verification', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> shiftWorkPlan(String shiftId) =>
      _api.get('shifts/$shiftId/work-plan', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> inspectionDetail(String inspectionId) =>
      _api.get('inspections/$inspectionId', parse: (b) => b as Map<String, dynamic>);

  /// The OCR review of ONE purchase (the driver may correct it before an admin
  /// verifies). The reconciliation inbox is a different thing.
  Future<Map<String, dynamic>> fuelPurchase(String purchaseId) =>
      _api.get('fuel/purchase/${_requireUuid(purchaseId)}/ocr', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> forceCloseShift(String shiftId, {String? reason}) => _api.write(
        'POST',
        'shifts/$shiftId/force-close',
        body: {'reason': ?reason},
        parse: (b) => b as Map<String, dynamic>,
      );

  Future<Map<String, dynamic>> driverDetail(String userId) =>
      _api.get('drivers/$userId', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> createDriver(Map<String, dynamic> body) =>
      _api.write('POST', 'drivers', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<void> userAction(String path, String userId, {String? reason}) => _api.write(
        'POST',
        path.replaceAll(':id', _requireUuid(userId)),
        body: {'reason': ?reason},
        parse: (b) => b,
      );

  Future<Map<String, dynamic>> vehicle(String id) =>
      _api.get('vehicles/${_requireUuid(id)}', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> createVehicle(Map<String, dynamic> body) =>
      _api.write('POST', 'vehicles', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> updateVehicle(String id, Map<String, dynamic> body) =>
      _api.write('PATCH', 'vehicles/${_requireUuid(id)}', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> reportVehicleIssue(String vehicleId, Map<String, dynamic> body) =>
      _api.write('POST', 'vehicles/$vehicleId/issues', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> pairTracker(Map<String, dynamic> body) =>
      _api.write('POST', 'admin/hardware/pair', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> importStatement(Map<String, dynamic> body) =>
      _api.write('POST', 'reconciliation/statements', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> completeTraining(String lessonId, {int? quizScore}) => _api.write(
        'POST',
        'training/lessons/$lessonId/complete',
        body: {'quiz_score': ?quizScore},
        parse: (b) => b as Map<String, dynamic>,
      );

  Future<Map<String, dynamic>> createTrainingLesson(Map<String, dynamic> body) => _api.write(
        'POST',
        'training/lessons',
        body: body,
        parse: (b) => b as Map<String, dynamic>,
      );

  Future<Map<String, dynamic>> trainingCourses({String? cursor}) =>
      _api.get('training/courses', query: cursor == null ? null : {'cursor': cursor}, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> createMaintenance(Map<String, dynamic> body) =>
      _api.write('POST', 'maintenance/work-orders', body: body, parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> createExportRequest(Map<String, dynamic> body) =>
      _api.write('POST', 'privacy/export-request', body: body, parse: (b) => b as Map<String, dynamic>);

  // auth helpers used by settings
  Future<void> changePassword(String current, String next) => _api.write(
        'POST',
        'auth/change-password',
        body: {'current_password': current, 'new_password': next},
        parse: (b) => b,
      );

  Future<List<String>> mfaEnroll(String password) async {
    final body = await _api.write<Map<String, dynamic>>(
      'POST',
      'auth/mfa/enroll',
      body: {'password': password},
      parse: (b) => b as Map<String, dynamic>,
    );
    return (body['recovery_codes'] as List?)?.cast<String>() ?? const [];
  }

  Future<void> revokeOwnDevice(String deviceIdHash) => _api.write(
        'POST',
        'auth/devices/revoke',
        body: {'device_id_hash': deviceIdHash},
        parse: (b) => b,
      );

  Future<void> revokeDevice(String deviceId) =>
      _api.write('POST', 'devices/$deviceId/revoke', body: const {}, parse: (b) => b);

  Future<void> revokeSessions({String? userId}) =>
      _api.write('POST', 'sessions/revoke', body: {'user_id': ?userId}, parse: (b) => b);

  Future<Map<String, dynamic>> passwordResetRequest(String contact) => _api.write(
        'POST',
        'auth/password-reset/request',
        body: {'email_or_phone': contact},
        parse: (b) => b as Map<String, dynamic>,
      );

  Future<void> passwordResetComplete(String resetId, String code, String newPassword) => _api.write(
        'POST',
        'auth/password-reset/$resetId/complete',
        body: {'code': code, 'new_password': newPassword},
        parse: (b) => b,
      );

  Future<Map<String, dynamic>> consentStatus() =>
      _api.get('me/consent', parse: (b) => b as Map<String, dynamic>);

  Future<Map<String, dynamic>> registerDevice(Map<String, dynamic> body) =>
      _api.write('POST', 'auth/devices', body: body, parse: (b) => b as Map<String, dynamic>);

  /// An id interpolated into a request path must be a UUID — anything else is
  /// a malformed request, never a path segment.
  String _requireUuid(String value) {
    if (!isUuid(value)) {
      throw HelixError(code: 'VALIDATION_ERROR', status: 400);
    }
    return value;
  }

  Future<Map<String, dynamic>> signup(Map<String, dynamic> body) =>
      _api.write('POST', 'auth/signup', body: body, parse: (b) => b as Map<String, dynamic>);
}

