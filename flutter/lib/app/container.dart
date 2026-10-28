import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import '../core/session.dart';
import '../core/api_client.dart';
import '../core/offline/queue.dart';
import '../core/media.dart';
import '../core/connectivity.dart';
import '../core/location.dart';
import '../core/offline/drain_scheduler.dart';
import '../core/secure_store.dart';
import '../core/kv_store.dart';
import '../core/realtime.dart';

/// Composition root: wires SessionService → ApiClient →
/// OfflineQueue → MediaService. Holds the shared service instances so screens
/// can reach them through Riverpod providers.
class AppContainer {
  AppContainer._({
    required this.session,
    required this.api,
    required this.queue,
    required this.media,
    required this.connectivity,
    required this.phoneTracker,
    required this.scheduler,
    required this.prefs,
    required this.drainedController,
    required this.realtime,
  });

  /// Session state machine (auth, PIN, consent, shell).
  final SessionService session;

  /// HTTP client with bearer token, idempotency, 401 replay.
  final ApiClient api;

  /// Offline write queue (serial, idempotent drain).
  final OfflineQueue queue;

  /// Media pipeline (resize → stage → presign → PUT).
  final MediaService media;

  /// Online/offline probe.
  final ConnectivityService connectivity;

  /// Phone-GPS fallback sampler.
  final PhoneTracker phoneTracker;

  /// Queue drain scheduler with backoff + jitter.
  final DrainScheduler scheduler;

  /// Preferences (locale + shell choice).
  final SharedPreferences prefs;

  /// Emits the paths of writes that drained successfully so the app can
  /// invalidate exactly the providers that read them.
  final StreamController<List<String>> drainedController;
  final RealtimeService realtime;
  Stream<List<String>> get drained => drainedController.stream;

  /// Builds a container from already-constructed services, for tests that
  /// need the real graph without the platform plugins (path provider,
  /// secure storage, connectivity) that [create] wires up.
  @visibleForTesting
  factory AppContainer.forTest({
    required ApiClient api,
    required OfflineQueue queue,
    required MediaService media,
    required ConnectivityService connectivity,
    required PhoneTracker phoneTracker,
    required DrainScheduler scheduler,
    required SharedPreferences prefs,
  }) {
    return AppContainer._(
      session: SessionService(store: MemoryKeyValueStore()),
      api: api,
      queue: queue,
      media: media,
      connectivity: connectivity,
      phoneTracker: phoneTracker,
      scheduler: scheduler,
      prefs: prefs,
      drainedController: StreamController<List<String>>.broadcast(),
      realtime: RealtimeService(
        tokenProvider: () async => null,
        onEvent: (_, _) {},
      ),
    );
  }

  static Future<AppContainer> create(
    SharedPreferences prefs, {
    SecurityContext? trustContext,
  }) async {
    final store = SecureStore.instance;
    final session = SessionService(store: store);
    session.attachPrefs(prefs);

    final api = ApiClient(
      accessToken: () async => session.accessToken,
      refreshTokens: () => session.refreshIfNeeded(),
      onAuthLost: () => session.signOut(),
      trustContext: trustContext,
    );

    session.attachApi(api);

    final db = await _openDatabase();
    final queueStore = await OfflineQueueStore.open(db);

    final mediaService = MediaService(api: api);

    final connectivity = ConnectivityService();
    await connectivity.init();

    final drained = StreamController<List<String>>.broadcast();

    final realtime = RealtimeService(
      tokenProvider: () async => session.accessToken,
      onEvent: (event, _) => drained.add([event]),
    );

    final queue = OfflineQueue(
      store: queueStore,
      api: api,
      uploadStaged: (upload) => mediaService.uploadStaged(upload),
      onDone: (paths) {
        if (paths.isEmpty) return;
        drained.add(paths);
      },
      refreshIfNeeded: () => session.refreshIfNeeded(),
      isOnline: () async => connectivity.isOnline,
    );

    final scheduler = DrainScheduler(
      drain: () => queue.drain(),
      arm: (_) {},
    );

    session.isOnlineProbe = () async => connectivity.isOnline;

    final container = AppContainer._(
      session: session,
      api: api,
      queue: queue,
      media: mediaService,
      connectivity: connectivity,
      phoneTracker: PhoneTracker(api: api),
      scheduler: scheduler,
      prefs: prefs,
      drainedController: drained,
      realtime: realtime,
    );

    // A reconnect is the moment the offline promise has to be kept.
    connectivity.changes.listen((online) {
      if (online) scheduler.kick();
    });

    // Realtime socket: listens for server-pushed invalidations.
    unawaited(realtime.connect());

    return container;
  }

  static Future<Database> _openDatabase() async {
    // Application support, not documents: the outbox holds driver PII and
    // must not be user-visible or swept into an iCloud backup.
    final dir = await getApplicationSupportDirectory();
    final path = '${dir.path}/queue.db';
    return await openDatabase(path, version: 1);
  }
}

/// Riverpod provider exposing the composition root to screens.
/// Must be overridden at app bootstrap via overrideWithValue.
final containerProvider = Provider<AppContainer>((ref) {
  throw UnimplementedError('containerProvider must be overridden at app bootstrap');
});
