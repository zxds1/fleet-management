import 'package:flutter/services.dart';

/// The native device-integrity probe.
///
/// The platform side checks for root/jailbreak indicators, a hooking
/// framework and an attached debugger. The probe is **advisory**: it fails
/// open, because a false positive locks a legitimate driver out of the app
/// and a missing probe is not a reason to refuse work.
class SecurityProbe {
  const SecurityProbe({required this.rooted, required this.hooked, required this.debuggerAttached, this.reason = ''});

  static const _channel = MethodChannel('helix/security');

  final bool rooted;
  final bool hooked;
  final bool debuggerAttached;
  final String reason;

  /// Runs the native probe. Never throws: a platform without the channel, a
  /// missing implementation or a native error all degrade to "nothing found".
  static Future<SecurityProbe> run() async {
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>('probe');
      if (result == null) return const SecurityProbe(rooted: false, hooked: false, debuggerAttached: false);
      return SecurityProbe(
        rooted: result['rooted'] == true,
        hooked: result['hooked'] == true,
        debuggerAttached: result['debuggerAttached'] == true,
        reason: result['reason']?.toString() ?? '',
      );
    } on MissingPluginException {
      return const SecurityProbe(rooted: false, hooked: false, debuggerAttached: false);
    } catch (_) {
      return const SecurityProbe(rooted: false, hooked: false, debuggerAttached: false);
    }
  }
}
