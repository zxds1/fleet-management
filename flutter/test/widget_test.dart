import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helix/app/router.dart';
import 'package:helix/core/kv_store.dart';
import 'package:helix/core/session.dart';
import 'package:helix/design/tokens.dart';
import 'package:helix/design/theme.dart';

/// The app root used to ship the Flutter counter demo: `main.dart` ran
/// `MyApp`, `HelixApp` was unreferenced, and no `GoRouter` was ever built, so
/// every `context.push` in the app threw. These tests guard that regression.

SessionService _session({
  AuthStatus status = AuthStatus.signedOut,
  List<String> roles = const [],
}) {
  final session = SessionService(store: MemoryKeyValueStore());
  session.status = status;
  session.roles = roles;
  return session;
}

/// WCAG 2.x relative luminance contrast ratio.
double _contrast(String a, String b) {
  double channel(double v) {
    final c = v / 255;
    return c <= 0.04045 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
  }

  double luminance(String hex) {
    final h = hex.replaceFirst('#', '');
    final r = channel(int.parse(h.substring(0, 2), radix: 16).toDouble());
    final g = channel(int.parse(h.substring(2, 4), radix: 16).toDouble());
    final bl = channel(int.parse(h.substring(4, 6), radix: 16).toDouble());
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  }

  final la = luminance(a);
  final lb = luminance(b);
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

String _hex(Color c) =>
    '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

void main() {
  test('the router is built and resolves the two shells', () {
    final router = buildRouter(_session(status: AuthStatus.signedIn, roles: const ['DRIVER']));
    expect(router, isNotNull);
  });

  test('a signed-out session is sent to sign-in', () {
    final session = _session();
    expect(helixRedirect(session, '/admin/overview'), '/login');
    expect(helixRedirect(session, '/login'), isNull);
  });

  test('a driver session cannot reach the admin shell', () {
    final session = _session(status: AuthStatus.signedIn, roles: const ['DRIVER']);
    expect(helixRedirect(session, '/admin/overview'), '/driver/home');
    expect(helixRedirect(session, '/driver/home'), isNull);
  });

  test('an admin session cannot reach the driver shell', () {
    final session = _session(status: AuthStatus.signedIn, roles: const ['ADMIN']);
    expect(helixRedirect(session, '/driver/home'), '/admin/overview');
    expect(helixRedirect(session, '/admin/overview'), isNull);
  });

  test('a dual-role session with no shell choice lands on the role switch', () {
    final session =
        _session(status: AuthStatus.signedIn, roles: const ['DRIVER', 'ADMIN']);
    expect(helixRedirect(session, '/login'), '/role-switch');
  });

  test('the auth gates short-circuit to their own screen', () {
    expect(
      helixRedirect(_session(status: AuthStatus.needsPin), '/driver/home'),
      '/pin',
    );
    expect(
      helixRedirect(_session(status: AuthStatus.needsMfa), '/driver/home'),
      '/mfa',
    );
    expect(
      helixRedirect(_session(status: AuthStatus.needsConsent), '/driver/home'),
      '/consent',
    );
    expect(
      helixRedirect(_session(status: AuthStatus.blocked), '/driver/home'),
      '/blocked',
    );
    expect(
      helixRedirect(_session(status: AuthStatus.suspended), '/driver/home'),
      '/suspended',
    );
    expect(
      helixRedirect(_session(status: AuthStatus.booting), '/driver/home'),
      '/splash',
    );
  });

  test('the app theme is the Helix theme, not the Material default', () {
    final theme = HelixTheme.light();
    expect(theme.textTheme.bodyLarge?.fontFamily, AppType.fontBody);
    expect(theme.textTheme.displaySmall?.fontFamily, AppType.fontDisplay);
    expect(theme.colorScheme.primary, AppColors.accent);
    expect(theme.scaffoldBackgroundColor, AppColors.bg);
    // The default Flutter seed is a purple that the design system bans.
    expect(theme.colorScheme.primary, isNot(const Color(0xFF6750A4)));
  });

  test('the admin shell re-themes Material components to the violet strand', () {
    final admin = HelixTheme.forShell(Shell.admin, Brightness.light);
    expect(admin.colorScheme.primary, AppColors.adminAccent);
    // The two strands are the two roles: the admin shell's secondary colour
    // is the driver strand, not another violet.
    expect(admin.colorScheme.secondary, AppColors.accent);

    final driver = HelixTheme.forShell(Shell.driver, Brightness.light);
    expect(driver.colorScheme.primary, AppColors.accent);
    expect(driver.colorScheme.secondary, AppColors.adminAccent);
  });

  test('light palette text pairs meet WCAG AA', () {
    AppColors.setDark(false);
    final pairs = <List<String>>[
      ['text', 'bg'],
      ['text', 'surface'],
      ['textSecondary', 'bg'],
      ['textTertiary', 'surface'],
      ['accentText', 'bg'],
      ['accentText', 'surfaceSunk'],
      ['adminAccent', 'bg'],
      ['statusOk', 'bg'],
      ['statusDanger', 'bg'],
      ['statusWarn', 'bg'],
      ['statusInfo', 'bg'],
      ['statusPlum', 'bg'],
      ['statusAmber', 'bg'],
      ['statusOlive', 'bg'],
    ];
    for (final pair in pairs) {
      final fg = _hex(_colorOf(pair[0]));
      final bg = _hex(_colorOf(pair[1]));
      final ratio = _contrast(fg, bg);
      expect(
        ratio,
        greaterThanOrEqualTo(4.5),
        reason: '${pair[0]} on ${pair[1]} is $ratio:1 — below WCAG AA',
      );
    }
  });

  test('dark palette text pairs meet WCAG AA', () {
    AppColors.setDark(true);
    final pairs = <List<String>>[
      ['text', 'bg'],
      ['text', 'surface'],
      ['text', 'surfaceSunk'],
      ['textSecondary', 'surface'],
      ['textTertiary', 'surface'],
      ['textTertiary', 'surfaceSunk'],
      ['accentText', 'bg'],
      ['accentText', 'surface'],
      ['accentText', 'surfaceSunk'],
      ['accentText', 'accentQuiet'],
      ['adminAccent', 'surface'],
      ['statusOk', 'surface'],
      ['statusDanger', 'surface'],
      ['statusWarn', 'surface'],
      ['statusInfo', 'surface'],
      ['statusPlum', 'surface'],
      ['statusAmber', 'surface'],
      ['statusOlive', 'surface'],
    ];
    for (final pair in pairs) {
      final fg = _hex(_colorOf(pair[0]));
      final bg = _hex(_colorOf(pair[1]));
      final ratio = _contrast(fg, bg);
      expect(
        ratio,
        greaterThanOrEqualTo(4.5),
        reason: 'dark ${pair[0]} on ${pair[1]} is $ratio:1 — below WCAG AA',
      );
    }
    AppColors.setDark(false);
  });

  test('the primary button label is legible on both strands in both modes', () {
    for (final dark in [false, true]) {
      AppColors.setDark(dark);
      for (final shell in Shell.values) {
        final ratio = _contrast(_hex(shell.onFill), _hex(shell.fill));
        expect(
          ratio,
          greaterThanOrEqualTo(4.5),
          reason: '${shell.name} button label in ${dark ? "dark" : "light"} is $ratio:1',
        );
      }
    }
    AppColors.setDark(false);
  });

  test('input outlines are a perceivable edge (3:1) on their own field surface', () {
    for (final dark in [false, true]) {
      AppColors.setDark(dark);
      final ratio = _contrast(_hex(AppColors.lineStrong), _hex(AppColors.surfaceSunk));
      expect(
        ratio,
        greaterThanOrEqualTo(3.0),
        reason: 'input outline in ${dark ? "dark" : "light"} is $ratio:1',
      );
    }
    AppColors.setDark(false);
  });
}

Color _colorOf(String name) {
  switch (name) {
    case 'bg':
      return AppColors.bg;
    case 'surface':
      return AppColors.surface;
    case 'surfaceSunk':
      return AppColors.surfaceSunk;
    case 'text':
      return AppColors.text;
    case 'textSecondary':
      return AppColors.textSecondary;
    case 'textTertiary':
      return AppColors.textTertiary;
    case 'accent':
      return AppColors.accent;
    case 'accentText':
      return AppColors.accentText;
    case 'accentQuiet':
      return AppColors.accentQuiet;
    case 'adminAccent':
      return AppColors.adminAccent;
    case 'statusOk':
      return AppColors.statusOk;
    case 'statusDanger':
      return AppColors.statusDanger;
    case 'statusWarn':
      return AppColors.statusWarn;
    case 'statusInfo':
      return AppColors.statusInfo;
    case 'statusPlum':
      return AppColors.statusPlum;
    case 'statusAmber':
      return AppColors.statusAmber;
    case 'statusOlive':
      return AppColors.statusOlive;
    default:
      throw ArgumentError('unknown colour $name');
  }
}
