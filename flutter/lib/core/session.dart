import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_client.dart';
import 'design_preview.dart';
import 'errors.dart';
import 'policy.dart';
import 'kv_store.dart';
import 'format.dart';

enum AuthStatus { booting, blocked, needsPin, signedOut, needsMfa, needsConsent, suspended, signedIn }

const List<String> adminRoles = ['ADMIN', 'FLEET_MANAGER', 'DISPATCHER', 'FINANCE', 'AUDITOR', 'SYSTEM_ADMIN'];

/// Outcome of an offline PIN check — the screen must not tell a driver
/// "wrong PIN" while the device is locked or wiped.
enum PinOutcome { ok, wrong, locked, wiped }

class PinVerification {
  const PinVerification.ok()
      : outcome = PinOutcome.ok,
        remainingAttempts = null,
        lockedUntil = null;
  const PinVerification.wrong(this.remainingAttempts)
      : outcome = PinOutcome.wrong,
        lockedUntil = null;
  const PinVerification.locked(this.lockedUntil)
      : outcome = PinOutcome.locked,
        remainingAttempts = null;
  const PinVerification.wiped()
      : outcome = PinOutcome.wiped,
        remainingAttempts = null,
        lockedUntil = null;

  final PinOutcome outcome;
  final int? remainingAttempts;
  final DateTime? lockedUntil;

  bool get isOk => outcome == PinOutcome.ok;
  bool get isWrong => outcome == PinOutcome.wrong;
  bool get isLocked => outcome == PinOutcome.locked;
  bool get isWiped => outcome == PinOutcome.wiped;
}

/// The auth state machine, now backed by Clerk (managed auth).
///
/// Clerk handles sign-in, sign-up, MFA, password reset, and session rotation.
/// SessionService owns the local state machine (PIN gate, consent, shell
/// choice). Credential operations are the API's own: /auth/login,
/// /auth/mfa/verify, /auth/refresh and /auth/logout.
///
/// Access token = the Helix-issued HS256 JWT, lives in memory only. The
/// refresh token is the durable half of the session and is rotated by the
/// server on every use.
class SessionService extends ChangeNotifier {
  SessionService({required this._store});

  final KeyValueStore _store;

  /// Optional Clerk session, kept only for a Clerk-hosted deployment. The
  /// Helix API issues and verifies its own HS256 tokens and has no way to
  /// verify a Clerk token, so the backend is the default path.
  late ApiClient _api;
  bool _apiAttached = false;

  /// Attached by the composition root (ApiClient needs the session's token
  /// getter, so the two are wired together there).
  void attachApi(ApiClient api) {
    _api = api;
    _apiAttached = true;
  }

  KeyValueStore get store => _store;

  AuthStatus status = AuthStatus.booting;
  String? securityReason;
  List<String> roles = const [];
  List<String> permissions = const [];
  String? userId;
  String? _accessToken;
  DateTime? _accessTokenExpiresAt;
  String? _pendingChallengeToken;
  bool _consentSatisfied = true;

  String? get accessToken => _accessToken;
  String? get pendingChallengeToken => _pendingChallengeToken;
  bool get consentSatisfied => _consentSatisfied;
  bool get signedIn => status == AuthStatus.signedIn;
  bool _preview = false;
  bool get isPreview => _preview;

  final _changes = StreamController<void>.broadcast();

  /// Auth/role changes as a stream. The session is exposed through a plain
  /// Provider, so a widget cannot listen to the ChangeNotifier directly.
  Stream<void> get changes => _changes.stream;

  @override
  void notifyListeners() {
    super.notifyListeners();
    if (!_changes.isClosed) _changes.add(null);
  }

  @override
  void dispose() {
    _changes.close();
    super.dispose();
  }

  /// Set by the composition root to ConnectivityService.
  Future<bool> Function()? _isOnlineProbe;
  set isOnlineProbe(Future<bool> Function()? probe) => _isOnlineProbe = probe;
  Future<bool> get _isOnline => _isOnlineProbe?.call() ?? Future.value(true);

  /// Wipes the offline queue and the staged media. Wired by the composition
  /// root (app/container.dart) — the session holds no queue reference.
  Future<void> Function()? localDataWipe;

  /// Reconciles the offline queue with the signed-in user: a different driver
  /// must not inherit the previous one's unsent writes. Wired by the
  /// composition root (app/container.dart).
  Future<void> Function(String userId)? queueOwnerReconciler;

  /// Offline design preview: installs the fixture session in place.
  Future<void> enterPreview() async {
    _preview = true;
    DesignPreview.markActive();
    _accessToken = 'preview-access-token';
    await persistShell('admin');
    roles = DesignPreview.roles;
    permissions = DesignPreview.permissions;
    userId = DesignPreview.userId;
    _consentSatisfied = true;
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  // — lifecycle —

  Future<void> boot({required bool secure}) async {
    status = AuthStatus.booting;
    notifyListeners();
    if (!secure) {
      status = AuthStatus.blocked;
      securityReason = 'rooted';
      notifyListeners();
      return;
    }
    _persistedShell = await _store.read(StoreKeys.activeShell);
    final refreshToken = await _store.read(StoreKeys.refreshToken);
    if (refreshToken == null || refreshToken.isEmpty) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    // Offline with a PIN on file → PIN gate first (only if we know we're offline).
    final pinHash = await _store.read(StoreKeys.pinHash);
    if (pinHash != null && !(await _isOnline)) {
      status = AuthStatus.needsPin;
      notifyListeners();
      return;
    }
    // The access token lives in memory only; the refresh token is the durable
    // half of the session, and rotating it re-establishes the principal.
    final restored = await _refresh();
    if (!restored) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    _consentSatisfied = (await _store.read(StoreKeys.consentVersion)) != null;
    await _reconcileQueueOwner(userId);
    if (!_consentSatisfied) {
      status = AuthStatus.needsConsent;
    } else {
      status = AuthStatus.signedIn;
    }
    notifyListeners();
  }

  /// Single-flight refresh. A Helix session refreshes against
  /// `POST /auth/refresh`; a Clerk session is rotated by Clerk itself, so the
  /// app only confirms a live token exists. Without either, there is no
  /// refresh capability and the answer is an honest "no".
  Future<bool> refreshIfNeeded() async {
    // A re-entrant call comes from the refresh request's own 401 handling.
    // Waiting for the in-flight refresh there would deadlock.
    if (_refreshing) return false;
    if (_refreshInFlight != null) return _refreshInFlight!.future;
    final completer = Completer<bool>();
    _refreshInFlight = completer;
    try {
      completer.complete(await _refresh());
    } catch (_) {
      completer.complete(false);
    }
    _refreshInFlight = null;
    return completer.future;
  }

  bool _refreshing = false;

  Future<bool> _refresh() async {
    _refreshing = true;
    try {
      return await _refreshInner();
    } finally {
      _refreshing = false;
    }
  }

  Future<bool> _refreshInner() async {
    final refreshToken = await _store.read(StoreKeys.refreshToken);
    if (refreshToken != null && refreshToken.isNotEmpty) {
      final expiresAt = _accessTokenExpiresAt;
      final stillFresh = expiresAt != null &&
          expiresAt.isAfter(DateTime.now().toUtc().add(const Duration(seconds: 30)));
      if (stillFresh) return true;
      if (!_apiAttached) return false;
      try {
        final res = await _api.write<Map<String, dynamic>>(
          'POST',
          'auth/refresh',
          body: {'refresh_token': refreshToken},
          retryOnUnauthorized: false,
          parse: (b) => b as Map<String, dynamic>,
        );
        await _applyBackendSession(res);
        return true;
      } on HelixError {
        _onAuthLost();
        return false;
      }
    }
    _onAuthLost();
    return false;
  }

  Completer<bool>? _refreshInFlight;

  void _onAuthLost() {
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  // — login flows —

  Future<SessionBody?> login({
    String? email,
    String? phone,
    required String password,
    String? deviceIdHash,
  }) async {
    if (!_apiAttached) {
      throw HelixError(code: 'UNAUTHENTICATED', status: 401);
    }
    try {
      final res = await _api.write<Map<String, dynamic>>(
        'POST',
        'auth/login',
        body: {
          if (email != null && email.trim().isNotEmpty) 'email': email.trim(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
          'password': password,
          if (deviceIdHash != null && deviceIdHash.isNotEmpty)
            'device_id_hash': deviceIdHash,
        },
        parse: (b) => b as Map<String, dynamic>,
      );
      if (res['mfa_required'] == true) {
        final challenge = res['mfa_challenge_token']?.toString();
        if (challenge != null && challenge.isNotEmpty) {
          beginMfaChallenge(challenge);
          return null;
        }
      }
      _pendingChallengeToken = null;
      final session = await _applyBackendSession(res);
      await _reconcileQueueOwner(session.userId);
      if (_apiAttached) await refreshConsentStatus();
      _advanceAfterAuth();
      return session;
    } on HelixError catch (e) {
      if (e.code == 'ACCOUNT_SUSPENDED') {
        status = AuthStatus.suspended;
        notifyListeners();
      } else if (e.code == 'MFA_REQUIRED' && e.challengeToken != null) {
        beginMfaChallenge(e.challengeToken!);
        return null;
      }
      rethrow;
    }
  }

  /// Starts an MFA challenge: the token comes from the sign-in response
  /// (`mfa_challenge_token`) and is spent by [verifyMfa].
  void beginMfaChallenge(String challengeToken) {
    _pendingChallengeToken = challengeToken;
    status = AuthStatus.needsMfa;
    notifyListeners();
  }

  /// MFA: verify a code against the challenge handed out at sign-in.
  ///
  /// A Helix-issued challenge is verified at `POST /auth/mfa/verify`; a Clerk
  /// session verifies the factor natively.
  Future<SessionBody> verifyMfa(String code) async {
    final challenge = _pendingChallengeToken;
    if (challenge == null) {
      throw HelixError(code: 'NO_MFA_CHALLENGE', status: 400);
    }
    return _verifyMfaWithBackend(challenge, code);
  }

  Future<SessionBody> _verifyMfaWithBackend(String challengeToken, String code) async {
    final res = await _api.write<Map<String, dynamic>>(
      'POST',
      'auth/mfa/verify',
      body: {'mfa_challenge_token': challengeToken, 'code': code},
      parse: (b) => b as Map<String, dynamic>,
    );
    final session = await _applyBackendSession(res);
    _pendingChallengeToken = null;
    _advanceAfterAuth();
    return session;
  }

  /// Adopts a Helix session body (login / refresh / mfa verify).
  Future<SessionBody> _applyBackendSession(Map<String, dynamic> res) async {
    final access = res['access_token']?.toString() ?? '';
    final refresh = res['refresh_token']?.toString() ?? '';
    final sessionRoles = (res['roles'] as List?)?.cast<String>() ?? const [];
    final sessionPermissions = (res['permissions'] as List?)?.cast<String>() ?? const [];
    _accessToken = access.isEmpty ? null : access;
    _accessTokenExpiresAt = Fmt.parseTimestamp(res['access_token_expires_at']?.toString());
    roles = sessionRoles;
    permissions = sessionPermissions;
    final sessionUserId = res['user_id']?.toString();
    if (sessionUserId != null && sessionUserId.isNotEmpty) userId = sessionUserId;
    await _store.write(StoreKeys.roles, jsonEncode(sessionRoles));
    await _store.write(StoreKeys.permissions, jsonEncode(sessionPermissions));
    if (userId != null) await _store.write(StoreKeys.userId, userId!);
    if (refresh.isNotEmpty) {
      await _store.write(StoreKeys.refreshToken, refresh);
      final refreshExpires = Fmt.parseTimestamp(res['refresh_token_expires_at']?.toString());
      if (refreshExpires != null) {
        await _store.write(StoreKeys.refreshExpiresAt, refreshExpires.toIso8601String());
      }
    }
    return SessionBody(
      accessToken: access,
      accessTokenExpiresAt: _accessTokenExpiresAt ?? DateTime.now().toUtc(),
      refreshToken: refresh,
      refreshTokenExpiresAt:
          Fmt.parseTimestamp(res['refresh_token_expires_at']?.toString()) ?? DateTime.now().toUtc(),
      sessionId: res['session_id']?.toString() ?? '',
      userId: userId ?? '',
      email: res['email']?.toString() ?? '',
      phone: res['phone']?.toString(),
      roles: sessionRoles,
      permissions: sessionPermissions,
      locale: res['locale']?.toString() ?? 'en',
    );
  }

  /// Company creation + sign-up via Clerk.
  Future<SessionBody> signup({
    required String companyName,
    required String fullName,
    required String email,
    String? phone,
    required String password,
  }) async {
    if (!_apiAttached) {
      throw HelixError(code: 'UNAUTHENTICATED', status: 401);
    }
    final res = await _api.write<Map<String, dynamic>>(
      'POST',
      'auth/signup',
      body: {
        'company_name': companyName.trim(),
        'email': email.trim(),
        'password': password,
        'full_name': fullName.trim(),
      },
      parse: (b) => b as Map<String, dynamic>,
    );
    final session = await _applyBackendSession(res);
    await _reconcileQueueOwner(session.userId);
    if (_apiAttached) await refreshConsentStatus();
    _advanceAfterAuth();
    return session;
  }

  Future<void> _reconcileQueueOwner(String? id) async {
    final reconcile = queueOwnerReconciler;
    if (reconcile == null || id == null || id.isEmpty) return;
    try {
      await reconcile(id);
    } catch (_) {
      // best effort — the queue keeps its rows either way
    }
  }

  void _advanceAfterAuth() {
    if (_consentSatisfied) {
      status = AuthStatus.signedIn;
    } else {
      status = AuthStatus.needsConsent;
    }
    notifyListeners();
  }

  Future<void> signOut() async {
    if (_apiAttached) {
      try {
        await _api.write<Map<String, dynamic>>(
          'POST',
          'auth/logout',
          body: const <String, dynamic>{},
          parse: (b) => (b as Map<String, dynamic>?) ?? const <String, dynamic>{},
        );
      } on HelixError {
        // best effort — the local session is cleared either way
      }
    }
    await _clear();
    await _wipeLocalData();
  }

  Future<void> _wipeLocalData() async {
    final wipe = localDataWipe;
    if (wipe == null) return;
    try {
      await wipe();
    } catch (_) {
      // best effort — the session is signed out either way
    }
  }

  Future<void> _clear() async {
    _accessToken = null;
    _accessTokenExpiresAt = null;
    roles = const [];
    permissions = const [];
    userId = null;
    _pendingChallengeToken = null;
    status = AuthStatus.signedOut;
    for (final key in [
      StoreKeys.refreshToken,
      StoreKeys.refreshExpiresAt,
      StoreKeys.lastAuthAt,
      StoreKeys.offlineUntil,
      StoreKeys.roles,
      StoreKeys.permissions,
      StoreKeys.userId,
      StoreKeys.pinHash,
      StoreKeys.pinSalt,
      StoreKeys.pinFailures,
      StoreKeys.pinLockedUntil,
      StoreKeys.consentVersion,
      StoreKeys.consentAt,
      StoreKeys.activeShell,
    ]) {
      await _store.delete(key);
    }
    notifyListeners();
  }

  // — consent —

  Future<void> acceptConsent(String version) async {
    await _api.write<Map<String, dynamic>>(
      'POST',
      'auth/consent',
      body: {'consent_type': 'GPS_TRACKING_WORKING_HOURS', 'policy_version': version},
      parse: (b) => b as Map<String, dynamic>,
    );
    await _store.write(StoreKeys.consentVersion, version);
    await _store.write(StoreKeys.consentAt, DateTime.now().toUtc().toIso8601String());
    _consentSatisfied = true;
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<void> refreshConsentStatus() async {
    try {
      final res = await _api.get<Map<String, dynamic>>('me/consent', parse: (b) => b as Map<String, dynamic>);
      _consentSatisfied = res['consented'] == true;
      if (status == AuthStatus.needsConsent && _consentSatisfied) {
        status = AuthStatus.signedIn;
        notifyListeners();
      }
    } on HelixError {
      _consentSatisfied = (await _store.read(StoreKeys.consentVersion)) != null;
    }
  }

  // — PIN —

  static const int pinSaltBytes = 16;
  static const String _pinHashPrefix = 'pbkdf2-sha256';

  /// PBKDF2-HMAC-SHA256 work factor for the offline PIN verifier.
  ///
  /// 600k iterations is the OWASP recommendation. On device the native
  /// backend (Android Conscrypt, iOS CommonCrypto) that
  /// `package:cryptography` selects automatically costs a few hundred
  /// milliseconds; the pure-Dart fallback is roughly fifty times slower, so
  /// the count is lowered for the test suite.
  @visibleForTesting
  static int pinKdfIterations = pinKdfIterationsProduction;

  /// The work factor shipped to devices.
  static const int pinKdfIterationsProduction = 600000;

  Future<void> setPin(String pin) async {
    final salt = _randomSaltHex();
    final hash = await _derivePinHash(pin, salt);
    await _store.write(StoreKeys.pinSalt, salt);
    await _store.write(StoreKeys.pinHash, hash);
    await _store.write(StoreKeys.pinFailures, '0');
  }

  Future<PinVerification> verifyPin(String pin) async {
    final hash = await _store.read(StoreKeys.pinHash);
    final salt = await _store.read(StoreKeys.pinSalt);
    if (hash == null || salt == null || !hash.startsWith('$_pinHashPrefix\$')) {
      // A legacy single-iteration digest cannot be checked safely, so the
      // verifier is treated as unset and the driver is asked for a new PIN.
      await _clearPin();
      return const PinVerification.wiped();
    }
    final lockedUntilMs = int.tryParse(await _store.read(StoreKeys.pinLockedUntil) ?? '');
    final failures = int.tryParse(await _store.read(StoreKeys.pinFailures) ?? '0') ?? 0;
    if (lockedUntilMs != null) {
      final until = DateTime.fromMillisecondsSinceEpoch(lockedUntilMs, isUtc: true);
      if (DateTime.now().toUtc().isBefore(until)) {
        // A locked device still counts the attempt. Without this the failure
        // counter stops at the lockout threshold and the wipe threshold is
        // unreachable — ten wrong PINs would never clear the verifier.
        final lockedAttempts = failures + 1;
        await _store.write(StoreKeys.pinFailures, '$lockedAttempts');
        if (lockedAttempts >= Policy.pinWipeAttempts) {
          await _clear();
          return const PinVerification.wiped();
        }
        return PinVerification.locked(until);
      }
    }
    final parsed = _parsePinHash(hash);
    if (parsed == null) {
      await _clearPin();
      return const PinVerification.wiped();
    }
    final candidate = await _derivePinHash(pin, salt, iterations: parsed.iterations);
    if (_constantTimeEquals(utf8.encode(candidate), utf8.encode(hash))) {
      await _store.write(StoreKeys.pinFailures, '0');
      await _store.delete(StoreKeys.pinLockedUntil);
      return const PinVerification.ok();
    }
    final next = failures + 1;
    await _store.write(StoreKeys.pinFailures, '$next');
    if (next >= Policy.pinWipeAttempts) {
      await _clear();
      return const PinVerification.wiped();
    }
    if (next >= Policy.pinLockoutAttempts) {
      final until = DateTime.now().toUtc().add(const Duration(minutes: Policy.pinLockoutMinutes));
      await _store.write(StoreKeys.pinLockedUntil, '${until.millisecondsSinceEpoch}');
      return PinVerification.locked(until);
    }
    return PinVerification.wrong(Policy.pinLockoutAttempts - next);
  }

  Future<void> _clearPin() async {
    await _store.delete(StoreKeys.pinHash);
    await _store.delete(StoreKeys.pinSalt);
    await _store.delete(StoreKeys.pinFailures);
    await _store.delete(StoreKeys.pinLockedUntil);
  }

  static String _randomSaltHex() {
    final rng = Random.secure();
    final bytes = List<int>.generate(pinSaltBytes, (_) => rng.nextInt(256));
    return _bytesToHex(bytes);
  }

  static String _bytesToHex(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

  static List<int> _hexToBytes(String hex) {
    final out = <int>[];
    for (var i = 0; i + 1 < hex.length; i += 2) {
      out.add(int.parse(hex.substring(i, i + 2), radix: 16));
    }
    return out;
  }

  /// PBKDF2-HMAC-SHA256 over a 4-digit PIN: a random 16-byte salt, a
  /// constant-time comparison, and a work factor that is recorded in the
  /// stored envelope so a verifier written with one factor still checks
  /// against another.
  static Future<String> _derivePinHash(
    String pin,
    String saltHex, {
    int? iterations,
  }) async {
    final rounds = iterations ?? pinKdfIterations;
    final algorithm = Pbkdf2.hmacSha256(iterations: rounds, bits: 256);
    final key = await algorithm.deriveKey(
      secretKey: SecretKey(utf8.encode(pin)),
      nonce: _hexToBytes(saltHex),
    );
    final derived = await key.extractBytes();
    return '$_pinHashPrefix\$$rounds\$${_bytesToHex(derived)}';
  }

  /// Splits `pbkdf2-sha256$<iterations>$<hex>` into its parts.
  static ({int iterations, String digest})? _parsePinHash(String hash) {
    final parts = hash.split(r'$');
    if (parts.length != 3 || parts[0] != _pinHashPrefix) return null;
    final iterations = int.tryParse(parts[1]);
    if (iterations == null || iterations <= 0) return null;
    return (iterations: iterations, digest: parts[2]);
  }

  static bool _constantTimeEquals(List<int> a, List<int> b) {
    var diff = a.length ^ b.length;
    final length = a.length < b.length ? a.length : b.length;
    for (var i = 0; i < length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }

  /// Register this device with the backend (called after login).
  Future<void> registerDevice({
    required String deviceIdHash,
    String? label,
    String? model,
    String? osVersion,
    String? appVersion,
    String? pushToken,
  }) async {
    await _api.write<Map<String, dynamic>>(
      'POST',
      'auth/devices',
      body: {
        'device_id_hash': deviceIdHash,
        'device_label': label,
        'device_model': model,
        'os_version': osVersion,
        'app_version': appVersion,
        'push_token': pushToken,
      },
      parse: (b) => b as Map<String, dynamic>,
    );
    await _store.write(StoreKeys.deviceIdHash, deviceIdHash);
  }

  Future<void> completePinUnlock() async {
    status = _consentSatisfied ? AuthStatus.signedIn : AuthStatus.needsConsent;
    notifyListeners();
  }

  // — helpers —

  SharedPreferences? _prefs;
  void attachPrefs(SharedPreferences prefs) => _prefs = prefs;

  String? _persistedShell;

  String? get persistedShell => _persistedShell ?? _prefs?.getString('helix.active_shell');

  Future<void> persistShell(String shell) async {
    _persistedShell = shell;
    await _store.write(StoreKeys.activeShell, shell);
    await _prefs?.setString('helix.active_shell', shell);
  }
}

/// Kept for backward compatibility with ApiClient and screens that pattern-match
/// on SessionBody fields.
class SessionBody {
  SessionBody({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
    required this.sessionId,
    required this.userId,
    required this.email,
    required this.phone,
    required this.roles,
    required this.permissions,
    required this.locale,
  });

  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String refreshToken;
  final DateTime refreshTokenExpiresAt;
  final String sessionId;
  final String userId;
  final String? email;
  final String? phone;
  final List<String> roles;
  final List<String> permissions;
  final String locale;

  bool get hasDriverRole => roles.contains('DRIVER');
  bool get hasAdminRole => roles.any(adminRoles.contains);
}
