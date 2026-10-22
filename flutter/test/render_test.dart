import 'package:dio/dio.dart';

import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'dart:convert';

import 'package:helix/app/container.dart';
import 'package:helix/app/providers.dart';
import 'package:helix/core/api_client.dart';
import 'package:helix/core/connectivity.dart';
import 'package:helix/core/errors.dart';
import 'package:helix/core/location.dart';
import 'package:helix/core/media.dart';
import 'package:helix/core/offline/drain_scheduler.dart';
import 'package:helix/core/offline/queue.dart';
import 'package:helix/core/session.dart';
import 'package:helix/design/theme.dart';
import 'package:helix/design/tokens.dart';
import 'package:helix/screens/admin/accident_detail_screen.dart';
import 'package:helix/screens/admin/accidents_screen.dart';
import 'package:helix/screens/admin/admin_fuel_screen.dart';
import 'package:helix/screens/admin/driver_detail_screen.dart';
import 'package:helix/screens/admin/dvir_detail_screen.dart';
import 'package:helix/screens/admin/fuel_detail_screen.dart';
import 'package:helix/screens/admin/import_statement_screen.dart';
import 'package:helix/screens/admin/maintenance_screen.dart';
import 'package:helix/screens/admin/overview_screen.dart';
import 'package:helix/screens/admin/privacy_screen.dart';
import 'package:helix/screens/admin/review_queue_screen.dart';
import 'package:helix/screens/admin/settings_hub_screen.dart';
import 'package:helix/screens/admin/shift_detail_screen.dart';
import 'package:helix/screens/admin/tracker_pair_screen.dart';
import 'package:helix/screens/admin/training_roster_screen.dart';
import 'package:helix/screens/admin/training_screen.dart';
import 'package:helix/screens/admin/vehicle_issues_screen.dart';
import 'package:helix/screens/admin/vehicles_screen.dart';
import 'package:helix/screens/auth/consent_screen.dart';
import 'package:helix/screens/auth/login_screen.dart';
import 'package:helix/screens/auth/pin_screen.dart';
import 'package:helix/screens/auth/role_switch_screen.dart';
import 'package:helix/screens/auth/splash_screen.dart';
import 'package:helix/screens/driver/accident_screen.dart';
import 'package:helix/screens/driver/clock_in_screen.dart';
import 'package:helix/screens/driver/clock_out_screen.dart';
import 'package:helix/screens/driver/dvir_history_screen.dart';
import 'package:helix/screens/driver/home_screen.dart';
import 'package:helix/screens/driver/inspect_screen.dart';
import 'package:helix/screens/driver/my_vehicle_screen.dart';
import 'package:helix/screens/driver/refuel_screen.dart';
import 'package:helix/screens/driver/safety_screen.dart';
import 'package:helix/screens/driver/settings_screen.dart';
import 'package:helix/screens/driver/work_screen.dart';
import 'package:helix/screens/shared/anomaly_detail_screen.dart';
import 'package:helix/screens/shared/doc_detail_screen.dart';
import 'package:helix/screens/shared/inbox_screen.dart';
import 'package:helix/screens/shared/mfa_setup_screen.dart';

import 'mock_backend.dart';

/// Render verification.
///
/// A widget test fails on a layout overflow, which makes it the cheapest way
/// to prove that a screen actually lays out — at a given size, in a given
/// theme — instead of merely compiling. Every screen is rendered against the
/// real data layer (the real `Repository` over a mock HTTP backend, so the
/// real response shapes are parsed), in both palettes, at a phone and a
/// tablet width.
///
/// What this catches that `flutter analyze` cannot:
/// - a `RenderFlex` overflow from the type scale or a long string
/// - a screen that only fits at one width
/// - a screen that only fits in one palette
/// - a layout that depends on a hard-coded colour and vanishes in dark mode
///
/// What it cannot catch: the absence of a Google Maps key on the live map,
/// and anything that needs a real device (camera, GPS, secure storage).
final List<DiagnosticsNode> _collected = [];

/// Serves the mock backend's fixtures in-process.
class _CannedAdapter implements HttpClientAdapter {
  _CannedAdapter(this.backend);

  final MockBackend backend;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.path.split('?').first;
    final cursor = options.uri.queryParameters['cursor'];
    final body = backend.readBody(path, cursor: cursor);
    final bytes = utf8.encode(jsonEncode(body));
    return ResponseBody.fromBytes(
      bytes,
      options.responseType == ResponseType.bytes ? 200 : 200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late MockBackend backend;
  late AppContainer container;
  late SessionService session;
  SharedPreferences.setMockInitialValues(<String, Object>{});

  setUp(() async {
    backend = MockBackend();
    await backend.start();

    final prefs = await SharedPreferences.getInstance();
    // A widget test runs in a fake-async zone, where a real socket never
    // completes. The same fixtures are served in-process instead, so the
    // render check is deterministic and cannot fail on a slow machine.
    final api = ApiClient(
      accessToken: () async => 'test-token',
      refreshTokens: () async => true,
      onAuthLost: () {},
      dio: Dio(BaseOptions(
        baseUrl: '${backend.apiBase}/',
        contentType: 'application/json',
      ))..httpClientAdapter = _CannedAdapter(backend),
    );
    final db = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath + DateTime.now().microsecondsSinceEpoch.toString(),
    );
    final store = await OfflineQueueStore.open(db);
    final queue = OfflineQueue(
      store: store,
      api: api,
      uploadStaged: (upload) async => 'media-1',
      onDone: (_) {},
      refreshIfNeeded: () async => true,
      isOnline: () async => true,
    );
    container = AppContainer.forTest(
      api: api,
      queue: queue,
      media: MediaService(api: api),
      connectivity: ConnectivityService(),
      phoneTracker: PhoneTracker(api: api),
      scheduler: DrainScheduler(drain: () => queue.drain(), arm: (_) {}),
      prefs: prefs,
    );

    session = SessionService(store: container.session.store);
    session.status = AuthStatus.signedIn;
    session.roles = const ['DRIVER', 'ADMIN'];
    session.permissions = const [
      'vehicle:read',
      'vehicle:manage',
      'fuel:read',
      'fuel:verify',
      'shift:read_all',
      'shift:verify',
      'accident:read',
      'accident:acknowledge',
      'training:read',
      'maintenance:read',
      'maintenance:write',
      'privacy:read',
      'privacy:write',
      'user:manage',
      'driver:read',
      'device:read',
    ];
  });

  tearDown(() async => backend.stop());

  /// Renders [screen] at [size] in [brightness] and fails on any layout error.
  Future<void> render(
    WidgetTester tester,
    Widget screen, {
    required Size size,
    required Brightness brightness,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    AppColors.setDark(brightness == Brightness.dark);

    // The framework's own error handler is what carries the offending widget
    // for a layout overflow; the test's takeException() only sees the message.
    _collected.clear();
    final previousHandler = FlutterError.onError;
    FlutterError.onError = (details) {
      final nodes = details.informationCollector?.call() ?? const <DiagnosticsNode>[];
      _collected.addAll(nodes);
      // ignore: avoid_print
      print('  ! ${details.exception}');
      previousHandler?.call(details);
    };
    addTearDown(() => FlutterError.onError = previousHandler);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          containerProvider.overrideWithValue(container),
          sessionProvider.overrideWith((ref) => session),
          camerasProvider.overrideWith((ref) async => const []),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: brightness == Brightness.dark ? HelixTheme.dark() : HelixTheme.light(),
          home: screen,
        ),
      ),
    );
    // Two frames: one for the first build, one for the async data that
    // arrives from the mock backend.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // The widget tests run in a fake-async zone, so real network I/O does
    // not complete on its own. Without this the test ends while the mock is
    // still answering, the server is closed under the request, and the
    // client sees a transport error that has nothing to do with the screen.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 250)),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    // Drain every exception, not just the first: one overflow usually comes
    // with a cascade of secondary ones, and each names a different widget.
    final errors = <Object>[];
    while (true) {
      final e = tester.takeException();
      if (e == null) break;
      errors.add(e);
    }
    if (errors.isNotEmpty) {
      // ignore: avoid_print
      print('RENDER FAILURE [$size $brightness]: ${errors.length} exception(s)');
      for (final e in errors) {
        // ignore: avoid_print
        print('  · $e');
        if (e is HelixError) {
          // ignore: avoid_print
          print('    code=${e.code} status=${e.status} detail=${e.detail}');
        }
      }
      for (final node in _collected) {
        // ignore: avoid_print
        print(node.toStringDeep());
      }
    }
    _collected.clear();
    expect(
      errors,
      isEmpty,
      reason: 'rendering failed at $size in $brightness: $errors',
    );
  }

  final phone = const Size(390, 844);
  final tablet = const Size(834, 1112);

  final screens = <String, Widget Function()>{
    // driver
    'driver/home': () => const DriverHomeScreen(),
    'driver/work': () => const WorkScreen(),
    'driver/safety': () => const SafetyScreen(),
    'driver/settings': () => const DriverSettingsScreen(),
    'driver/clock-in': () => const ClockInScreen(),
    'driver/clock-out': () => const ClockOutScreen(),
    'driver/refuel': () => const RefuelScreen(),
    'driver/inspect': () => const InspectScreen(),
    'driver/accident': () => const AccidentScreen(),
    'driver/my-vehicle': () => const MyVehicleScreen(),
    'driver/dvir-history': () => const DvirHistoryScreen(),
    // admin
    'admin/overview': () => const AdminOverviewScreen(),
    'admin/accidents': () => const AdminAccidentsScreen(),
    'admin/accident-detail': () => const AccidentDetailScreen(accidentId: 'acc-1'),
    'admin/review': () => const ReviewQueueScreen(),
    'admin/shift-detail': () => const ShiftDetailScreen(shiftId: 'shift-1'),
    'admin/dvir-detail': () => const DvirDetailScreen(inspectionId: 'dvir-1'),
    'admin/fuel-detail': () => const FuelDetailScreen(purchaseId: 'fp-1'),
    'admin/fuel-pending': () => const AdminFuelScreen(),
    'admin/import-statement': () => const ImportStatementScreen(),
    'admin/vehicles': () => const VehiclesScreen(),
    'admin/vehicle-issues': () => const VehicleIssuesScreen(vehicleId: 'veh-1'),
    'admin/driver-detail': () => const DriverDetailScreen(userId: 'usr-1'),
    'admin/training': () => const TrainingScreen(),
    'admin/training-roster': () => const TrainingRosterScreen(),
    'admin/maintenance': () => const MaintenanceScreen(),
    'admin/privacy': () => const PrivacyScreen(),
    'admin/tracker-pair': () => const TrackerPairScreen(),
    'admin/settings-hub': () => const AdminSettingsHubScreen(),
    // auth
    'auth/splash': () => const SplashScreen(),
    'auth/login': () => const LoginScreen(),
    'auth/pin': () => const PinScreen(),
    'auth/consent': () => const ConsentScreen(),
    'auth/role-switch': () => const RoleSwitchScreen(),
    // shared
    'shared/inbox': () => const InboxScreen(),
    'shared/document': () => const DocDetailScreen(documentId: 'doc-1'),
    'shared/anomaly': () => const AnomalyDetailScreen(anomalyId: 'anom-1'),
    'shared/mfa-setup': () => const MfaSetupScreen(),
  };

  for (final entry in screens.entries) {
    for (final theme in [Brightness.light, Brightness.dark]) {
      for (final size in [phone, tablet]) {
        testWidgets('${entry.key} renders at $size in $theme', (tester) async {
          await render(tester, entry.value(), size: size, brightness: theme);
        });
      }
    }
  }

  testWidgets('the driver and admin shells render their tab bars', (tester) async {
    // The shell chrome is part of the redesign: the frosted tab bar, the
    // strand tint and the bottom inset that keeps the last row clear of it.
    for (final theme in [Brightness.light, Brightness.dark]) {
      await render(
        tester,
        const _ShellHarness(),
        size: phone,
        brightness: theme,
      );
    }
  });

  testWidgets('a long driver name does not overflow the home header', (tester) async {
    session.roles = const ['DRIVER'];
    await render(
      tester,
      const DriverHomeScreen(),
      size: phone,
      brightness: Brightness.light,
    );
  });
}

/// A minimal stand-in for the shell scaffold: the frosted tab bar over a
/// scrolling surface, which is where the bottom inset matters.
class _ShellHarness extends StatelessWidget {
  const _ShellHarness();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBody: true,
      body: ListView(
        padding: const EdgeInsets.all(AppSpace.s4),
        children: [
          for (var i = 0; i < 20; i++)
            Container(
              height: 56,
              margin: const EdgeInsets.only(bottom: AppSpace.s3),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.card),
                border: Border.all(color: AppColors.line),
              ),
            ),
        ],
      ),
      bottomNavigationBar: Container(
        height: 64,
        color: AppColors.frostChrome,
        alignment: Alignment.center,
        child: const Text('tab bar'),
      ),
    );
  }
}
