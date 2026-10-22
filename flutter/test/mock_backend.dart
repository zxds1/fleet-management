import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:helix/core/ids.dart';

/// A semantics-faithful in-process stand-in for the fleet-management backend.
/// It reproduces the parts of the contract the app depends on:
///  - mount table (/api/v1 base)
///  - RFC7807 problems with error_code
///  - the Idempotency-Key middleware (REPLAY / INFLIGHT / CONFLICT)
///  - refresh-token rotation (each refresh token is single-use)
///  - camelCase responses where the routers are camelCase (media, fuel verify)
///  - keyset cursor pagination ({data, next_cursor, has_more})
///  - media presign → PUT → 302 read
///  - the ingest bounds on POST /telemetry/points
class MockBackend {
  MockBackend({this.basePath = '/api/v1'});

  final String basePath;
  HttpServer? _server;
  late final String host;

  // ── state ──
  final Map<String, Map<String, dynamic>> _sessions = {}; // refresh token hash -> session row
  final _accessToken = 'access-token-1';
  final List<String> _usedRefreshTokens = <String>[];
  final Map<String, _IdemRecord> _idempotency = {};
  final List<Map<String, dynamic>> _notifications = [
    {'id': newUuid(), 'title': 'Shift verified', 'body': 'Your shift was verified.', 'priority': 'NORMAL', 'status': 'QUEUED', 'created_at': DateTime.now().toUtc().toIso8601String(), 'payload': <String, dynamic>{}},
    {'id': newUuid(), 'title': 'Fuel flagged', 'body': 'A purchase was flagged.', 'priority': 'HIGH', 'status': 'SENT', 'created_at': DateTime.now().toUtc().toIso8601String(), 'payload': <String, dynamic>{}},
  ];
  final Map<String, String> _readNotifications = {};
  final List<Map<String, dynamic>> _vehicles = [
    {'id': newUuid(), 'license_plate': 'KAA 123A', 'vehicle_class': 'TRACTOR', 'status': 'AVAILABLE', 'is_operational': true, 'make': 'Scania', 'model': 'R500', 'current_odometer_km': 128400},
  ];
  final List<Map<String, dynamic>> _shifts = [];
  final List<Map<String, dynamic>> _purchases = [
    {'fuel_purchase_id': 'seed-1', 'verified': false},
    {'fuel_purchase_id': 'seed-2', 'verified': false},
  ];
  final List<Map<String, dynamic>> _inspections = [];
  final List<Map<String, dynamic>> _accidents = [];
  final List<Map<String, dynamic>> _telemetryBatches = [];
  // ignore: unused_field
  String? _currentUserId;
  bool failNextWithServiceUnavailable = false;

  /// When set, the session body carries an access token that is already past
  /// its expiry, so the client must take the refresh path.
  bool expireAccessTokens = false;
  int refreshCount = 0;
  String? openShiftIdForTest; // test-visible accessor for the ingest-bounds scenarios
  final List<String> receivedIdempotencyKeys = <String>[];
  final List<Map<String, dynamic>> receivedBodies = <Map<String, dynamic>>[];

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    host = 'http://127.0.0.1:${_server!.port}';
    _server!.listen(_handle);
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }

  String get apiBase => '$host$basePath';

  void _handle(HttpRequest request) async {
    final path = request.uri.path;
    final method = request.method;
    // the raw presigned PUT is handled before the body reader
    if (path.startsWith('/_upload/')) {
      await request.drain();
      request.response.statusCode = 200;
      request.response.contentLength = 0;
      await request.response.close();
      return;
    }
    final body = await _readBody(request);
    final auth = request.headers.value('authorization');
    final idemKey = request.headers.value('idempotency-key');
    if (idemKey != null) receivedIdempotencyKeys.add(idemKey);
    if (body != null && body.isNotEmpty) receivedBodies.add(jsonDecode(body) as Map<String, dynamic>);

    try {
      // media reads answer 302 to a short-lived presigned GET
      if (path.startsWith('$basePath/media/') && method == 'GET') {
        request.response.statusCode = 302;
        request.response.headers.set(HttpHeaders.locationHeader, '$host/_upload/${path.split('/').last}');
        await request.response.close();
        return;
      }
      final response = await _route(method, path, request, body, auth, idemKey);
      if (response != null) await _write(request, response);
    } on _HttpProblem catch (e) {
      _write(request, {'status': e.status, 'problem': true, 'body': {'error_code': e.code, 'detail': e.detail}});
    } catch (e, st) {
      stderr.writeln('mock error: $e\n$st');
      _write(request, {'status': 500, 'problem': true, 'body': {'error_code': 'TRANSACTION_FAILED', 'detail': 'Mock failure'}});
    }
  }

  /// The users the fixture has enrolled a second factor for.
  static bool _mfaEnrolled(Object? identifier) => identifier == 'mfa@example.com';

  Future<Map<String, dynamic>?> _route(String method, String path, HttpRequest request, String? rawBody, String? auth, String? idemKey) async {
    // ignore: avoid_print
    // ── auth ──
    if (path == '$basePath/auth/login' && method == 'POST') {
      final body = jsonDecode(rawBody!) as Map<String, dynamic>;
      final hasEmail = body['email'] != null;
      final hasPhone = body['phone'] != null;
      if (hasEmail == hasPhone) return _problem(400, 'VALIDATION_ERROR', 'email XOR phone');
      if (body['password'] != 'correct-horse') {
        return _problem(401, 'UNAUTHENTICATED', 'Bad credentials');
      }
      if (body['mfa_code'] == null && _mfaEnrolled(body['email'] ?? body['phone'])) {
        // A second factor is enrolled: no session is issued until the code is
        // verified, exactly as the API does.
        return _ok(200, {
          'mfa_required': true,
          'mfa_challenge_token': 'challenge-1',
        });
      }
      return _ok(201, _sessionBody());
    }
    if (path == '$basePath/auth/mfa/verify' && method == 'POST') {
      final body = jsonDecode(rawBody!) as Map<String, dynamic>;
      if (body['code'] != '123456') return _problem(401, 'MFA_REQUIRED', 'Bad code');
      return _ok(200, _sessionBody());
    }
    if (path == '$basePath/auth/refresh' && method == 'POST') {
      final body = jsonDecode(rawBody!) as Map<String, dynamic>;
      final token = body['refresh_token'] as String;
      if (_usedRefreshTokens.contains(token)) {
        return _problem(401, 'UNAUTHENTICATED', 'Refresh token reuse');
      }
      if (!_sessions.containsKey(token)) {
        return _problem(401, 'UNAUTHENTICATED', 'Unknown refresh token');
      }
      _usedRefreshTokens.add(token);
      refreshCount += 1;
      return _ok(200, _sessionBody());
    }
    if (path == '$basePath/auth/devices' && method == 'POST') {
      _requireAuth(request, auth);
      return _ok(200, {'device_id': newUuid(), 'push_token': 'push-token'});
    }
    if (path == '$basePath/auth/devices/pin' && method == 'POST') {
      _requireAuth(request, auth);
      return _ok(200, {'pin_set': true});
    }
    if (path == '$basePath/auth/devices/revoke' && method == 'POST') {
      _requireAuth(request, auth);
      return _ok(200, {'revoked': true});
    }
    if (path == '$basePath/auth/consent' && method == 'POST') {
      _requireAuth(request, auth);
      return _ok(200, {'consent_id': newUuid(), 'accepted': true});
    }
    if (path == '$basePath/me/consent' && method == 'GET') {
      _requireAuth(request, auth);
      return _ok(200, {'consented': true, 'current_version': '2026.1', 'required_version': '2026.1'});
    }
    if (path == '$basePath/auth/signup' && method == 'POST') {
      final body = jsonDecode(rawBody!) as Map<String, dynamic>;
      if (body['email'] == 'taken@example.com') {
        return _problem(409, 'EMAIL_TAKEN', 'Email taken');
      }
      final session = _sessionBody(roles: ['ADMIN']);
      return _ok(201, {...session, 'tenant_id': newUuid()});
    }
    if (path.startsWith('$basePath/auth/password-reset') && method == 'POST') {
      return _ok(200, {'reset_id': newUuid(), 'status': 'PENDING', 'contact_hint': 't**@e.com', 'requires_approval': true});
    }
    if (path == '$basePath/auth/logout' && method == 'POST') {
      _requireAuth(request, auth);
      return _ok(200, {'logged_out': true});
    }

    // telemetry ingest is idempotency-exempt and enforces its own bounds
    if (path == '$basePath/telemetry/points' && method == 'POST') {
      _requireAuth(request, auth);
      final body = rawBody == null || rawBody.isEmpty ? const <String, dynamic>{} : jsonDecode(rawBody) as Map<String, dynamic>;
      final points = (body['points'] as List?) ?? const [];
      if (points.length > 60) return _problem(400, 'VALIDATION_ERROR', 'max 60 points per batch');
      for (var i = 1; i < points.length; i++) {
        final prev = DateTime.parse((points[i - 1] as Map)['recorded_at'] as String);
        final cur = DateTime.parse((points[i] as Map)['recorded_at'] as String);
        if (cur.difference(prev).inSeconds < 10) {
          return _problem(400, 'VALIDATION_ERROR', 'TOO_DENSE: 10s sampling floor');
        }
      }
      if (openShiftIdForTest == null) {
        return _problem(403, 'FORBIDDEN', 'Vehicle is resolved from the open shift only');
      }
      _telemetryBatches.add(body);
      return _ok(202, {'accepted': points.length, 'shift_id': openShiftIdForTest});
    }

    // ── idempotent write helper ──
    if (_isIdempotentWrite(method, path)) {
      final key = idemKey;
      if (key == null) {
        return _problem(400, 'VALIDATION_ERROR', 'Idempotency-Key required', fieldErrors: [
          {'field': 'Idempotency-Key', 'code': 'IDEMPOTENCY_KEY_REQUIRED', 'message': 'required'}
        ]);
      }
      final hash = _hash(rawBody ?? '');
      final existing = _idempotency[key];
      if (existing != null) {
        if (existing.bodyHash != hash) {
          return _problem(422, 'IDEMPOTENCY_CONFLICT', 'Same key, different body');
        }
        request.response.headers.set('Idempotency-Replayed', 'true');
        return _ok(existing.status, existing.body);
      }
      if (_inflightKeys.contains(key)) {
        return _problem(409, 'IDEMPOTENCY_INFLIGHT', 'First attempt still running');
      }
      _inflightKeys.add(key);
      try {
        final outcome = await _writeRoute(method, path, request, rawBody, auth);
        if (outcome.statusCode < 500 && outcome.statusCode != 429 && outcome.statusCode != 408) {
          // a thrown/transport failure RELEASES the claim so a retry can re-run
          _idempotency[key] = _IdemRecord(bodyHash: hash, status: outcome.statusCode, body: outcome.body);
        }
        return _ok(outcome.statusCode, outcome.body);
      } finally {
        _inflightKeys.remove(key);
      }
    }

    return await _readRoute(method, path, request, rawBody, auth);
  }

  final List<String> _inflightKeys = <String>[];

  bool _isIdempotentWrite(String method, String path) {
    if (method == 'GET') return false;
    const excluded = [
      '/auth/refresh',
      '/auth/devices/refresh',
      '/media/upload-url',
      '/telemetry/points',
      '/vehicles/assign',
    ];
    if (excluded.any((e) => path.endsWith(e))) return false;
    return path.startsWith(basePath) && (path.contains('/auth/') || true);
  }

  Future<_Outcome> _writeRoute(String method, String path, HttpRequest request, String? rawBody, String? auth) async {
    _requireAuth(request, auth);
    final body = rawBody == null || rawBody.isEmpty ? const <String, dynamic>{} : jsonDecode(rawBody) as Map<String, dynamic>;

    if (failNextWithServiceUnavailable) {
      failNextWithServiceUnavailable = false;
      return _outcome(503, {'error_code': 'SERVICE_UNAVAILABLE'});
    }

    if (path == '$basePath/shifts/clock-in') {
      if (body['assignment_id'] == null) {
        return _outcomeProblem(409, 'NO_ASSIGNMENT', 'No vehicle assigned');
      }
      final shiftId = newUuid();
      openShiftIdForTest = shiftId;
      _shifts.add({'shift_id': shiftId, 'state': 'OPEN', 'clock_in_at': DateTime.now().toUtc().toIso8601String(), 'vehicle_id': body['vehicle_id']});
      return _outcome(201, {
        'shift_id': shiftId,
        'clock_in_at': DateTime.now().toUtc().toIso8601String(),
        'disclaimer': 'Your hours are recorded from clock-in. Drive safe.',
      });
    }
    if (path == '$basePath/shifts/clock-out') {
      return _outcome(200, {'shift_id': body['shift_id']});
    }
    if (path == '$basePath/driver/fuel/purchase') {
      final id = newUuid();
      _purchases.add({'fuel_purchase_id': id, 'verified': false});
      return _outcome(201, {'fuelPurchaseId': id, 'pricePerLiter': 178.5}); // camelCase route
    }
    if (path == '$basePath/inspections') {
      for (final item in (body['items'] as List? ?? const [])) {
        final map = item as Map<String, dynamic>;
        if (map['result'] == 'FAIL' && map['photo_media_object_id'] == null) {
          return _outcomeProblem(422, 'DVIR_FAIL_NEEDS_PHOTO', 'A FAIL item has no photo');
        }
      }
      final id = newUuid();
      _inspections.add({'inspection_id': id, 'status': 'SUBMITTED'});
      return _outcome(201, {'inspection_id': id, 'block_shift': false});
    }
    if (path == '$basePath/accidents/mayday') {
      final id = newUuid();
      _accidents.add({'accident_id': id, 'mayday': true});
      return _outcome(201, {'accident_id': id, 'escalated_at': null});
    }
    if (path == '$basePath/accidents') {
      final id = newUuid();
      _accidents.add({'accident_id': id, 'mayday': false});
      return _outcome(201, {'accident_id': id});
    }
    if (path == '$basePath/fuel/purchases/1/verify' || path.endsWith('/verify')) {
      return _outcome(200, {'fuelPurchaseId': '1', 'status': 'VERIFIED'});
    }
    if (path == '$basePath/trailer/swap') {
      return _outcome(201, {
        'trailer_assignment_id': newUuid(),
        'dropped_trailer_id': null,
        'created_trailer_id': null,
      });
    }
    if (path == '$basePath/vehicles' && method == 'POST') {
      final vehicle = {'id': newUuid(), ...body, 'is_operational': true, 'current_odometer_km': 0};
      _vehicles.add(vehicle);
      return _outcome(201, vehicle);
    }
    if (path.startsWith('$basePath/notifications/') && path.endsWith('/read')) {
      final id = path.split('/')[3];
      _readNotifications[id] = DateTime.now().toUtc().toIso8601String();
      return _outcome(204, {});
    }
    if (path == '$basePath/notifications/read-all') {
      for (final n in _notifications) {
        _readNotifications[n['id'] as String] = DateTime.now().toUtc().toIso8601String();
      }
      return _outcome(204, {});
    }
    if (path.startsWith('$basePath/sessions/revoke')) return _outcome(204, {});
    if (path.startsWith('$basePath/drivers/') && path.endsWith('/approve')) {
      return _outcome(200, {'user_id': path.split('/')[3], 'status': 'ACTIVE'});
    }
    if (path.startsWith('$basePath/admin/users/') && (path.endsWith('/suspend') || path.endsWith('/reinstate'))) {
      final suspend = path.endsWith('/suspend');
      if (suspend) _currentUserId = null;
      return _outcome(200, {'user_id': path.split('/')[3], 'status': suspend ? 'SUSPENDED' : 'ACTIVE'});
    }
    return _outcome(404, {'error_code': 'NOT_FOUND'});
  }

  Future<Map<String, dynamic>> _readRoute(String method, String path, HttpRequest request, String? rawBody, String? auth) async {
    _requireAuth(request, auth);
    return readBody(path, cursor: request.uri.queryParameters['cursor']);
  }

  /// The canned body for a GET, without going through a socket.
  ///
  /// A widget test runs in a fake-async zone, where a real HTTP request never
  /// completes — so the render suite drives the same fixtures through a Dio
  /// adapter instead of a server.
  Map<String, dynamic> readBody(String path, {String? cursor}) {

    if (path == '$basePath/drivers/me/onboarding') {
      return _ok(200, {
        'id': newUuid(),
        'driver_id': newUuid(),
        'full_name': 'Amina Driver',
        'licence_number': 'DL-9911',
        'background_check_status': 'CLEARED',
        'onboarding_complete': true,
      });
    }
    if (path == '$basePath/drivers/me/assignment') {
      return _ok(200, {
        'id': newUuid(),
        'vehicle_id': newUuid(),
        'vehicle_label': 'KAA 123A',
        'trailer_id': null,
      });
    }
    if (path == '$basePath/shifts/me/active') {
      if (openShiftIdForTest == null) return _ok(200, null);
      return _ok(200, {'shift_id': openShiftIdForTest, 'vehicle_id': _vehicles.first['id'], 'trailer_id': null, 'clock_in_at': DateTime.now().toUtc().toIso8601String()});
    }
    if (path == '$basePath/inspections/templates') {
      return _ok(200, {
        'templates': [
          {
            'template_id': newUuid(),
            'label': 'Daily tractor check',
            'subject': 'VEHICLE',
            'items': [
              {'template_item_id': newUuid(), 'code': 'BRAKES', 'label_en': 'Brakes', 'label_sw': 'Breki', 'severity': 'BLOCKER', 'input_type': 'PASS_FAIL', 'is_required': true, 'sequence': 1},
              {'template_item_id': newUuid(), 'code': 'REEFER', 'label_en': 'Reefer temp', 'label_sw': 'Joto reefer', 'severity': 'WARNING', 'input_type': 'NUMERIC', 'unit': 'C', 'min_value': -25, 'max_value': 5, 'is_required': true, 'sequence': 2},
            ],
          },
        ],
      });
    }
    if (path == '$basePath/fuel/cards') {
      return _ok(200, {
        'cards': [
          {'id': newUuid(), 'label': 'Fleet card 1', 'provider': 'VISA', 'is_pooled': true},
        ],
      });
    }
    if (path == '$basePath/media/upload-url') {
      return _ok(201, {
        'media_object_id': newUuid(),
        'upload_url': '$host/_upload/${newUuid()}',
        'expires_in_seconds': 60,
        'method': 'PUT',
      });
    }
    if (path == '$basePath/dashboard/vehicle-states') {
      return _ok(200, {
        'vehicles': [
          {
            'vehicle_id': _vehicles.first['id'],
            'display_state': 'MOVING',
            'latitude': -1.2921,
            'longitude': 36.8219,
            'driver_name': 'Amina Driver',
            'plate': 'KAA 123A',
            'next_eligible_clock_in_at': DateTime.now().toUtc().add(const Duration(hours: 6)).toIso8601String(),
            'odometer_km': 128400,
            'is_online': true,
            'asset_status': 'AVAILABLE',
          },
        ],
      });
    }
    if (path == '$basePath/reports/analytics' || path == '$basePath/analytics/company') {
      return _ok(200, {
        'tenant_id': newUuid(),
        'from': '2026-10-01',
        'to': '2026-10-14',
        'kpis': {'vehicles': 1, 'drivers': 2, 'distanceKm': 410.5, 'fuelCost': 91222.50, 'anomalies': 3},
        'managers': [],
        'active_fleet': 1,
        'open_accidents': 0,
        'pending_dvir': 1,
        'fuel_spend_30d': 91222.50,
        'expiring_docs': 2,
        'anomalies_open': 3,
      });
    }
    if (path == '$basePath/fuel/reconciliation-inbox') {
      final data = _purchases.map((p) => {'fuel_purchase_id': p['fuel_purchase_id'], 'driver_name': 'Amina Driver', 'vehicle_plate': 'KAA 123A', 'station_name': 'Shell', 'amount_spent': 9030.75, 'liters_pumped': 50.2, 'odometer_km': 128450, 'confidence_score': 0.82, 'verified': false, 'badge': 'REVIEW'}).toList();
      return _page(200, data, cursor, 50);
    }
    if (path == '$basePath/notifications/count') {
      final unread = _notifications.where((n) => !_readNotifications.containsKey(n['id'])).length;
      return _ok(200, {'total': _notifications.length, 'unread': unread});
    }
    return _ok(200, {'data': const [], 'next_cursor': null, 'has_more': false});
  }

  // ── media read: the 302 the client must follow ──
  // registered by start() as a raw path: /media/:id

  Map<String, dynamic> _ok(int status, Object? body) => {'status': status, 'body': body};

  _Outcome _outcome(int status, Map<String, dynamic> body) => _Outcome(status, body);
  _Outcome _outcomeProblem(int status, String code, String detail) =>
      _Outcome(status, {'error_code': code, 'detail': detail});

  String _hash(Object? body) => body == null ? 'e3b0' : body.toString().hashCode.toRadixString(16);

  Map<String, dynamic> _sessionBody({List<String>? roles}) {
    final refreshToken = 'refresh-${newUuid()}';
    _sessions[refreshToken] = {
      'user_id': newUuid(),
      'roles': roles ?? ['DRIVER'],
      'permissions': _allPermissions,
    };
    _currentUserId = _sessions[refreshToken]!['user_id'] as String?;
    return {
      'token_type': 'Bearer',
      'access_token': _accessToken,
      'access_token_expires_at': expireAccessTokens
          ? DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String()
          : DateTime.now().toUtc().add(const Duration(minutes: 15)).toIso8601String(),
      'refresh_token': refreshToken,
      'refresh_token_expires_at': DateTime.now().toUtc().add(const Duration(days: 7)).toIso8601String(),
      'session_id': newUuid(),
      'user_id': _sessions[refreshToken]!['user_id'],
      'email': 'amina@example.com',
      'phone': '+254700000001',
      'roles': roles ?? ['DRIVER'],
      'permissions': _allPermissions,
      'locale': 'en',
    };
  }

  static const List<String> _allPermissions = [
    'shift:clock_in', 'shift:clock_out', 'shift:read_own', 'inspection:submit', 'inspection:read',
    'trailer:swap', 'fuel:submit_purchase', 'accident:report', 'accident:read', 'hos:read',
    'asset:read', 'assignment:read', 'notification:read', 'notification:manage', 'onboarding:read',
    'onboarding:submit', 'manage_own_mfa', 'revoke_device', 'user:read', 'user:manage', 'report:read',
    'fuel:read', 'fuel:verify', 'fuel:adjust', 'fuel:clear_payment', 'shift:read_all', 'shift:verify',
    'shift:force_close', 'accident:acknowledge', 'training:read', 'training:review', 'training:complete',
    'maintenance:read', 'maintenance:record', 'document:read', 'document:manage', 'privacy:request_own',
    'privacy:view_requests_tenant', 'config:read', 'config:manage', 'device:revoke', 'asset:create',
    'asset:update', 'vehicle:report', 'fuel:reconcile', 'anomaly:read',
  ];

  void _requireAuth(HttpRequest request, String? auth) {
    if (auth == null || !auth.startsWith('Bearer ')) {
      throw _HttpProblem(401, 'UNAUTHENTICATED', 'Missing bearer');
    }
    if (auth == 'Bearer expired') {
      throw _HttpProblem(401, 'UNAUTHENTICATED', 'Access token expired');
    }
  }


  Map<String, dynamic> _page(int status, List<Map<String, dynamic>> data, String? cursor, int limit) {
    final start = cursor == null ? 0 : int.parse(cursor);
    final slice = data.skip(start).take(limit).toList();
    final next = start + limit;
    return _ok(status, {
      'data': slice,
      'next_cursor': next < data.length ? '$next' : null,
      'has_more': next < data.length,
    });
  }

  Future<String?> _readBody(HttpRequest request) async {
    if (request.method == 'GET' || request.method == 'HEAD') return null;
    final content = await request.fold<List<int>>(<int>[], (a, b) => a..addAll(b));
    if (content.isEmpty) return null;
    return utf8.decode(content);
  }

  Future<void> _write(HttpRequest request, Map<String, dynamic> result) async {
    final status = result['status'] as int;
    final body = result['body'];
    request.response.statusCode = status;
    if (status == 204) {
      // 204 must not carry a body
      request.response.headers.set(HttpHeaders.connectionHeader, 'close');
      await request.response.close();
      return;
    }
    final isProblem = result['problem'] == true;
    request.response.headers.contentType =
        isProblem ? ContentType('application', 'problem+json') : ContentType.json;
    // Dart's HttpServer does not support request pipelining: a second request
    // that arrives on a connection before the first response is written comes
    // back as a bodiless 400. Closing the connection keeps every request
    // independent, the way a real server on a keep-alive pool behaves.
    request.response.headers.set(HttpHeaders.connectionHeader, 'close');
    request.response.write(jsonEncode(body));
    await request.response.close();
  }

  Map<String, dynamic> _problem(int status, String code, String detail,
      {List<Map<String, dynamic>>? fieldErrors}) {
    return {
      'status': status,
      'problem': true,
      'body': {
        'type': 'about:blank',
        'title': code,
        'status': status,
        'detail': detail,
        'error_code': code,
        'field_errors': ?fieldErrors,
      },
    };
  }
}

class _IdemRecord {
  _IdemRecord({required this.bodyHash, required this.status, required this.body});
  final String bodyHash;
  final int status;
  final Object? body;
}

class _Outcome {
  _Outcome(this.statusCode, this.body);
  final int statusCode;
  final Map<String, dynamic> body;
}

class _HttpProblem implements Exception {
  _HttpProblem(this.status, this.code, this.detail);
  final int status;
  final String code;
  final String detail;
}
