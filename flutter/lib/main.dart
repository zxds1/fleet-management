import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/container.dart';
import 'app/providers.dart';
import 'core/config.dart';
import 'core/demo_backend.dart';
import 'core/pinning.dart';
import 'core/security.dart';
import 'core/security_probe.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final prefs = await SharedPreferences.getInstance();

  if (Config.demoMode && !kIsWeb) {
    final backend = MockBackend();
    await backend.start();
    Config.demoOverrideUrl = '${backend.host}/api/v1';
  }

  // The API's CA certificate, bundled so the client trusts it and nothing
  // else. Absent in a development build, where the system roots are fine.
  final trustContext = await loadTrustContext(assetPath: Config.pinnedCaAsset);

  final container = await AppContainer.create(prefs, trustContext: trustContext);

  final scope = ProviderContainer(
    overrides: [containerProvider.overrideWithValue(container)],
  );

  // Resolve the user's stored preferences before the first frame so the app
  // never flashes the wrong locale or theme.
  await scope.read(localeProvider.notifier).load();
  scope.read(themeModeProvider.notifier).load();

  // The session state machine decides where the router sends the user, and
  // the device-integrity verdict decides whether it is allowed to start at all.
  final probe = await SecurityProbe.run();
  final verdict = securityVerdict(
    rooted: probe.rooted,
    hooked: probe.hooked,
    debuggerAttached: probe.debuggerAttached,
    releaseBuild: !kDebugMode,
  );
  await container.session.boot(secure: verdict.secure);

  // Queued writes are only useful if something drains them.
  container.scheduler.kick();

  runApp(
    UncontrolledProviderScope(
      container: scope,
      child: const HelixApp(),
    ),
  );
}
