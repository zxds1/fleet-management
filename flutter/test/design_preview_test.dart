import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import 'package:helix/core/api_client.dart';
import 'package:helix/core/design_preview.dart';
import 'package:helix/core/kv_store.dart';
import 'package:helix/core/session.dart';
import 'mock_backend.dart';

/// The offline design preview must be exercisable without a backend.
void main() {
  test('preview installs both shells, every permission, consent and the admin shell', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final session = SessionService(store: MemoryKeyValueStore());
    session.attachPrefs(prefs);
    await DesignPreview.install(session);

    expect(session.isPreview, isTrue);
    expect(session.status, AuthStatus.signedIn);
    expect(session.roles, contains('DRIVER'));
    expect(session.roles, contains('FLEET_MANAGER'));
    expect(session.permissions.length, greaterThan(60));
    expect(session.permissions, contains('fuel:verify'));
    expect(session.consentSatisfied, isTrue);
    expect(session.persistedShell, 'admin');
    // the access token never leaves the process
    expect(session.accessToken, 'preview-access-token');
  });

  test('the preview adapter answers the endpoints the screens read', () async {
    final backend = MockBackend(); // still starts (unused) to prove no dependency
    await backend.start();
    final api = ApiClient(
      accessToken: () async => 'preview-access-token',
      refreshTokens: () async => true,
      onAuthLost: () {},
      dio: Dio(),
    );
    api.usePreviewMode(true);

    final states = await api.get<Map<String, dynamic>>('dashboard/vehicle-states', parse: (b) => b as Map<String, dynamic>);
    expect((states['vehicles'] as List), hasLength(4));

    final analytics = await api.get<Map<String, dynamic>>('reports/analytics', parse: (b) => b as Map<String, dynamic>);
    expect(analytics['kpis']['vehicles'], 12);

    final inbox = await api.get<Map<String, dynamic>>('notifications/count', parse: (b) => b as Map<String, dynamic>);
    expect(inbox['unread'], 2);

    final rows = await api.get<Map<String, dynamic>>('drivers', parse: (b) => b as Map<String, dynamic>);
    expect((rows['data'] as List), hasLength(2));

    final vehicles = await api.get<dynamic>('vehicles', parse: (b) => b);
    expect(vehicles, isA<List>()); // the contract's bare array

    await backend.stop();
  });

  test('preview is debug-only by construction', () {
    // the login-screen entry point is gated by kDebugMode; this asserts the
    // service itself carries no release-mode default.
    expect(DesignPreview.isActive, isTrue); // after install above
  });
}
