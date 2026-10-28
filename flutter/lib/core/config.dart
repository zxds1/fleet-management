import 'pinning.dart';

/// Runtime configuration. Defaults match the local stack:
/// API on :4000 (docker-compose), WS gateway on :8081 (run separately).
class Config {
  Config._();
  static const String _defaultApiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000/api/v1',
  );
  static const String apiBaseUrl = _defaultApiBaseUrl;
  /// Mutable override used by demo mode to point at the in-process mock backend.
  static String? demoOverrideUrl;
  static const String _defaultWsUrl = String.fromEnvironment(
    'WS_URL',
    defaultValue: 'ws://localhost:8081',
  );
  static const String wsUrl = _defaultWsUrl;
  static const String adminContactUrl = String.fromEnvironment(
    'ADMIN_CONTACT_URL',
    defaultValue: 'tel:+254700000000',
  );
  /// Whether a release build refuses to run without pin material.
  static const bool requirePinning =
      bool.fromEnvironment('REQUIRE_PINNING', defaultValue: true);

  /// Base64 (or hex) SHA-256 of each acceptable leaf certificate, supplied at
  /// build time. At least two are required so a single compromised or
  /// mis-issued certificate cannot take the fleet's traffic down with it.
  static final List<String> sslPins = parsePins(
    const String.fromEnvironment('PINNED_CERT_SHA256', defaultValue: ''),
  );

  /// The tile source. The default is the OpenStreetMap public tiles, which
  /// need no key; a deployment with its own tile provider (or a commercial
  /// one) swaps it in at build time with `--dart-define=MAP_TILE_URL=...`.
  ///
  /// The Google Maps SDK this replaced hard-required an API key and rendered
  /// a blank grey tile without one. `flutter_map` is pure Dart, so the map
  /// works out of the box.
  static const String mapTileUrl = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  /// Where the attribution leads. The tile provider's usage policy requires a
  /// visible, tappable credit.
  static const String mapAttributionUrl = String.fromEnvironment(
    'MAP_ATTRIBUTION_URL',
    defaultValue: 'https://www.openstreetmap.org/copyright',
  );

  /// The CA certificate the client trusts and nothing else, shipped as an
  /// asset. An empty value means "use the system roots", which is only
  /// acceptable outside a release build.
  static const String pinnedCaAsset =
      String.fromEnvironment('PINNED_CA_ASSET', defaultValue: 'assets/pins/api-ca.pem');

  static const bool demoMode = bool.fromEnvironment('DEMO_MODE', defaultValue: false);
  static const String urlScheme = 'helix';
  static const String consentVersion = '2026.1'; // must match the server's CONSENT_REQUIRED_VERSION
}
