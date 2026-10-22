import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'container.dart';
import 'router.dart';
import '../core/media.dart';
import '../core/session.dart';
import '../core/offline/queue.dart';
import '../i18n/strings.dart';

/// Session provider — exposes SessionService to screens via Riverpod.
///
/// [SessionService] is a [ChangeNotifier]; a plain `Provider` would return the
/// same instance forever and no screen would ever rebuild when the auth
/// state, the roles or the permission union changed.
final sessionProvider = ChangeNotifierProvider<SessionService>((ref) {
  return ref.watch(containerProvider).session;
});

/// The router. Built once from the session so the redirect can re-evaluate on
/// every auth-state change.
final routerProvider = Provider<GoRouter>((ref) {
  return buildRouter(ref.watch(containerProvider).session);
});

/// Media provider — exposes MediaService to screens via Riverpod.
final mediaProvider = Provider<MediaService>((ref) {
  return ref.watch(containerProvider).media;
});

/// Offline queue provider — exposes OfflineQueue to screens via Riverpod.
final offQueueProvider = Provider<OfflineQueue>((ref) {
  return ref.watch(containerProvider).queue;
});

/// Camera provider — the available cameras, after the permission prompt.
/// An empty list means the permission was refused or no camera exists; the
/// capture UI turns that into an honest state rather than a silent failure.
final camerasProvider = FutureProvider<List<CameraDescription>>((ref) async {
  final status = await Permission.camera.request();
  if (!status.isGranted) return const [];
  try {
    return await availableCameras();
  } catch (_) {
    return const [];
  }
});

/// Badge counts provider — tracks pending/failed outbox items.
class BadgeCountsNotifier extends StateNotifier<int> {
  BadgeCountsNotifier() : super(0);

  void setOutbox(int count) => state = count;
}

final badgeCountsProvider = StateNotifierProvider<BadgeCountsNotifier, int>((ref) {
  return BadgeCountsNotifier();
});

/// Locale provider — the app locale. Selection order (B-19): remembered
/// explicit choice → device locale → English.
final localeProvider = StateNotifierProvider<LocaleController, Locale>((ref) {
  final container = ref.watch(containerProvider);
  return LocaleController(container.prefs, container.session.store);
});

/// Theme mode — system by default, with an explicit override the user can
/// choose. Dark mode is a first-class surface ("Night Ops"), not a leftover.
class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController(this._prefs) : super(ThemeMode.system);

  static const _key = 'helix.theme_mode';

  final SharedPreferences _prefs;

  void load() {
    final stored = _prefs.getString(_key);
    state = switch (stored) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  void set(ThemeMode mode) {
    state = mode;
    _prefs.setString(_key, mode.name);
  }
}

final themeModeProvider = StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController(ref.watch(containerProvider).prefs);
});

/// The platform brightness, so the app can follow the system in dark mode.
final platformBrightnessProvider = StreamProvider<Brightness>((ref) {
  final dispatcher = WidgetsBinding.instance.platformDispatcher;
  late final StreamController<Brightness> controller;
  controller = StreamController<Brightness>.broadcast(
    onListen: () {
      controller.add(dispatcher.platformBrightness);
      dispatcher.onPlatformBrightnessChanged =
          () => controller.add(dispatcher.platformBrightness);
    },
    onCancel: () => dispatcher.onPlatformBrightnessChanged = null,  );
  ref.onDispose(controller.close);
  return controller.stream;
});
