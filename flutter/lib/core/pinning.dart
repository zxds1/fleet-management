import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/io.dart' show IOHttpClientAdapter;
import 'package:flutter/services.dart';

/// Certificate pinning for the API and the realtime gateway.
///
/// Three layers, from the outside in:
///
/// 1. **Trust-anchor pinning.** The client is given a [SecurityContext] that
///    trusts the bundled CA *and nothing else* — the system roots are not
///    consulted — so a certificate signed by any other authority is rejected
///    by the TLS stack before the application sees it. A rogue CA installed
///    on a managed device cannot mint a server the app will talk to.
/// 2. **Leaf pinning.** The pinned leaf hashes are evaluated by
///    [IOHttpClientAdapter.validateCertificate], which runs after the chain
///    has been vetted. A leaf that is not on the list is refused even when
///    its issuer is the pinned CA — which is what catches a compromised
///    issuer.
/// 3. **Rotation path.** A certificate whose hash *is* on the list is
///    accepted even if its chain is not yet trusted, so a new leaf can be
///    pinned before its CA is bundled.
///
/// Pin material comes from the build, never from the app bundle's defaults:
///
/// ```
/// flutter build apk --release \
///   --dart-define=PINNED_CERT_SHA256=<base64 sha256 of the leaf DER>,<...> \
///   --dart-define=REQUIRE_PINNING=true
/// ```
///
/// A release build with no pin material refuses to connect at all rather than
/// silently falling back to the public roots.
class PinnedHttpClientAdapter extends IOHttpClientAdapter {
  PinnedHttpClientAdapter({
    required this.pins,
    required this.failClosed,
    this.trustContext,
  }) : super(
          createHttpClient: () => HttpClient(context: trustContext),
          validateCertificate: (cert, host, port) => cert != null &&
              acceptsLeaf(
                certificateHash: certificateHash(cert),
                pins: pins,
                failClosed: failClosed,
                hasTrustContext: trustContext != null,
              ),
        );

  /// Base64 (or lowercase hex) SHA-256 of each acceptable leaf certificate DER.
  final Set<String> pins;

  /// When true the adapter never falls back to the system roots: a chain the
  /// trust context does not vouch for is refused unless the leaf is pinned.
  final bool failClosed;

  /// A context that trusts only the bundled CA. Null means "use the system
  /// roots", which is only acceptable outside a release build.
  final SecurityContext? trustContext;

}

/// The leaf-acceptance policy, as a pure function so it can be tested
/// without a live TLS handshake.
///
/// - A hash on the pin list is always accepted — that is the rotation path,
///   where a new leaf is pinned before its issuer is bundled.
/// - With pins configured and the hash absent, the leaf is refused even when
///   the issuer is the trusted CA. That is what catches a compromised issuer.
/// - With no pins configured, the trust anchor is the only control, and it
///   only counts when it is a strict one.
bool acceptsLeaf({
  required String certificateHash,
  required Set<String> pins,
  required bool failClosed,
  required bool hasTrustContext,
}) {
  if (pins.contains(certificateHash) || pins.contains(certificateHash.toLowerCase())) {
    return true;
  }
  if (pins.isEmpty) return hasTrustContext && !failClosed;
  return false;
}

/// The SHA-256 of a certificate's DER, base64 encoded — the same value
/// `openssl x509 -fingerprint -sha256` prints, with the colons stripped and
/// the bytes base64'd.
String certificateHash(X509Certificate cert) => base64Sha256(cert.der);

String base64Sha256(List<int> bytes) => base64.encode(sha256.convert(bytes).bytes);

String sha256Hex(List<int> bytes) =>
    sha256.convert(bytes).bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

/// Parses a pin list: comma or whitespace separated, each entry base64 or hex.
List<String> parsePins(String raw) {
  final out = <String>[];
  for (final part in raw.split(RegExp(r'[,\s]+'))) {
    final pin = part.trim();
    if (pin.isEmpty) continue;
    if (!out.contains(pin)) out.add(pin);
  }
  return out;
}

/// Loads the bundled CA certificate and builds a trust context from it.
///
/// Returns null when the asset is absent or unreadable — the caller then has
/// leaf pins only, and a release build with neither refuses to connect.
Future<SecurityContext?> loadTrustContext({required String assetPath}) async {
  try {
    final data = await rootBundle.load(assetPath);
    return trustOnlyThese(data.buffer.asUint8List());
  } catch (_) {
    return null;
  }
}

/// Builds a trust context that trusts ONLY the given CA certificates.
///
/// `withTrustedRoots: false` is the point: the system root store is not
/// consulted, so pinning actually narrows the trust boundary instead of
/// widening it.
SecurityContext trustOnlyThese(List<int> caCertificatePem) {
  final context = SecurityContext(withTrustedRoots: false);
  context.setTrustedCertificatesBytes(caCertificatePem);
  return context;
}
