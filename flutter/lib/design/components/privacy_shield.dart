import 'dart:async';

import 'package:flutter/material.dart';
import 'package:screen_protector/screen_protector.dart';

/// Blocks screen capture and hides the app-switcher snapshot on the screens
/// that carry sensitive material (accident statements, recovery codes, HOS).
///
/// The OS-level protection is [FLAG_SECURE] on Android and a blurred
/// switcher snapshot on iOS — the plugin applies both, so there is no
/// in-app watermark: a 14dp mark in the corner of every screen is noise that
/// competes with the data and protects nothing.
class PrivacyShield extends StatefulWidget {
  const PrivacyShield({super.key, required this.child});

  final Widget child;

  @override
  State<PrivacyShield> createState() => _PrivacyShieldState();
}

class _PrivacyShieldState extends State<PrivacyShield> {
  static int _depth = 0;

  @override
  void initState() {
    super.initState();
    _depth++;
    if (_depth == 1) unawaited(_protect());
  }

  @override
  void dispose() {
    _depth--;
    if (_depth == 0) unawaited(_unprotect());
    super.dispose();
  }

  /// The plugin is absent in a test environment and on a platform that does
  /// not implement it. The call is asynchronous, so the failure surfaces in
  /// the future — it has to be awaited, not just wrapped in a try.
  Future<void> _protect() async {
    try {
      await ScreenProtector.preventScreenshotOn();
      await ScreenProtector.protectDataLeakageWithBlur();
    } catch (_) {
      // No platform support here; the app still runs.
    }
  }

  Future<void> _unprotect() async {
    try {
      await ScreenProtector.preventScreenshotOff();
      await ScreenProtector.protectDataLeakageWithBlurOff();
    } catch (_) {
      // Nothing was protected.
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// The Helix mark as a round badge, for the places a compact brand spot
/// belongs. The artwork is the same source the launcher icon is generated
/// from — nothing here is drawn by hand.
class HelixLogoMark extends StatelessWidget {
  const HelixLogoMark({super.key, this.size = 14});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Image.asset(
        'assets/brand/helix_badge_circle.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.medium,
      ),
    );
  }
}
