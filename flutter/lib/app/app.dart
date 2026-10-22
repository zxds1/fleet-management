import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../design/components/media_thumb.dart';
import '../design/tokens.dart';
import '../design/theme.dart';
import 'container.dart';
import 'providers.dart';

/// The application root.
///
/// The active palette is resolved here, before the themed subtree is built, so
/// every `AppColors.x` read inside the app resolves against the palette the
/// theme is actually using. Dark mode is a real surface, not an inversion.
class HelixApp extends ConsumerStatefulWidget {
  const HelixApp({super.key});

  @override
  ConsumerState<HelixApp> createState() => _HelixAppState();
}

class _HelixAppState extends ConsumerState<HelixApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // A suspended app runs no timers, so anything the queue was waiting to
    // send is still waiting when it comes back. This is the moment to try
    // again, and the moment the connectivity state may have changed.
    if (state == AppLifecycleState.resumed) {
      final container = ref.read(containerProvider);
      container.scheduler.kick();
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);
    final locale = ref.watch(localeProvider);
    final systemBrightness = ref.watch(platformBrightnessProvider).value;

    final dark = switch (themeMode) {
      ThemeMode.dark => true,
      ThemeMode.light => false,
      ThemeMode.system =>
        (systemBrightness ?? WidgetsBinding.instance.platformDispatcher.platformBrightness) ==
            Brightness.dark,
    };
    AppColors.setDark(dark);

    return InheritedApi(
      api: ref.watch(containerProvider).api,
      child: MaterialApp.router(
        title: 'Helix',
        debugShowCheckedModeBanner: false,
        theme: HelixTheme.light(),
        darkTheme: HelixTheme.dark(),
        themeMode: themeMode,
        locale: locale,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('en'), Locale('sw')],
        routerConfig: router,
      ),
    );
  }
}
