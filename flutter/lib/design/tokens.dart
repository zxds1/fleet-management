import 'package:flutter/material.dart';

/// Design tokens — "Field Instrument" (see flutter/.design/helix-flutter-app/DESIGN_TOKENS.md).
/// Single source of truth: components reference these, never raw values.
///
/// Palette: two immutable [HelixPalette] instances, one per brightness. The
/// dark palette is *derived*, not inverted — every text pair in it was
/// contrast-checked against its own surfaces (the light accent-text tone is
/// unreadable on graphite, so the dark palette carries its own).
///
/// Resolution: [AppColors.x] resolves against the *active* palette, which the
/// app sets with [AppColors.setDark] immediately before it builds the themed
/// subtree. Call sites stay `AppColors.x` — there is no per-site migration and
/// no per-site `Theme.of(context)` lookup.
class HelixPalette {
  const HelixPalette({
    required this.bg,
    required this.surface,
    required this.surfaceSunk,
    required this.surfaceInverse,
    required this.text,
    required this.textSecondary,
    required this.textTertiary,
    required this.textInverse,
    required this.line,
    required this.lineStrong,
    required this.accent,
    required this.accentText,
    required this.accentPressed,
    required this.accentQuiet,
    required this.onAccent,
    required this.adminAccent,
    required this.adminAccentQuiet,
    required this.adminAccentPressed,
    required this.onAdminAccent,
    required this.statusOk,
    required this.statusDanger,
    required this.statusWarn,
    required this.statusWarnFill,
    required this.statusInfo,
    required this.statusNeutral,
    required this.statusPlum,
    required this.statusAmber,
    required this.statusOlive,
  });

  final Color bg;
  final Color surface;
  final Color surfaceSunk;
  final Color surfaceInverse;
  final Color text;
  final Color textSecondary;
  final Color textTertiary;
  final Color textInverse;
  final Color line;
  final Color lineStrong;

  final Color accent;
  final Color accentText;
  final Color accentPressed;
  final Color accentQuiet;

  /// Label colour for content sitting *on* the accent fill.
  final Color onAccent;

  final Color adminAccent;
  final Color adminAccentQuiet;
  final Color adminAccentPressed;

  /// Label colour for content sitting *on* the admin accent fill.
  final Color onAdminAccent;

  final Color statusOk;
  final Color statusDanger;
  final Color statusWarn;
  final Color statusWarnFill;
  final Color statusInfo;
  final Color statusNeutral;
  final Color statusPlum;
  final Color statusAmber;
  final Color statusOlive;

  /// "Daylight Field" — warm paper surfaces, ink type.
  static const light = HelixPalette(
    bg: Color(0xFFF6F3EC),
    surface: Color(0xFFFDFCF7),
    surfaceSunk: Color(0xFFEFEBE1),
    surfaceInverse: Color(0xFF0F172A), // logo navy
    text: Color(0xFF191713),
    textSecondary: Color(0xFF57503F),
    textTertiary: Color(0xFF6E6759),
    textInverse: Color(0xFFF6F3EC),
    line: Color(0xFFD8D2C4),
    lineStrong: Color(0xFF8C8266), // input outline — ≥3:1 on surfaceSunk
    accent: Color(0xFF06B6D4), // driver strand — fills/indicators
    accentText: Color(0xFF0E7490), // AA-safe tone of the same strand
    accentPressed: Color(0xFF0891B2),
    accentQuiet: Color(0xFFDFF3F8),
    onAccent: Color(0xFF191713),
    adminAccent: Color(0xFF6D28D9), // admin strand
    adminAccentQuiet: Color(0xFFEEE9FD),
    adminAccentPressed: Color(0xFF5B21B6),
    onAdminAccent: Color(0xFFFFFFFF),
    statusOk: Color(0xFF166B3F),
    statusDanger: Color(0xFF9E2B1F),
    statusWarn: Color(0xFF8A5A00),
    statusWarnFill: Color(0xFFF5B400),
    statusInfo: Color(0xFF2A5EA8),
    statusNeutral: Color(0xFF5C6468),
    statusPlum: Color(0xFF7A1F5C),
    statusAmber: Color(0xFFA85500),
    statusOlive: Color(0xFF7A6100),
  );

  /// "Night Ops" — warm graphite. Every value re-derived against the dark
  /// surfaces; the light accent-text tone is not reused (it measures 3.07:1
  /// on graphite and would fail AA).
  static const dark = HelixPalette(
    bg: Color(0xFF141310),
    surface: Color(0xFF211F19),
    surfaceSunk: Color(0xFF0C0B09),
    surfaceInverse: Color(0xFFF6F3EC),
    text: Color(0xFFECE9E0),
    textSecondary: Color(0xFFA8A394),
    textTertiary: Color(0xFF948D7E),
    textInverse: Color(0xFF141310),
    line: Color(0xFF3A372E),
    lineStrong: Color(0xFF847C6D),
    accent: Color(0xFF22D3EE),
    accentText: Color(0xFF22D3EE),
    accentPressed: Color(0xFF0CA5C4),
    accentQuiet: Color(0xFF1B2A30),
    onAccent: Color(0xFF141310),
    adminAccent: Color(0xFFA78BFA),
    adminAccentQuiet: Color(0xFF2A1F42),
    adminAccentPressed: Color(0xFF8B5CF6),
    onAdminAccent: Color(0xFF141310),
    statusOk: Color(0xFF5CB87E),
    statusDanger: Color(0xFFE0776A),
    statusWarn: Color(0xFFD9A22E),
    statusWarnFill: Color(0xFFF5B400),
    statusInfo: Color(0xFF7FA8E8),
    statusNeutral: Color(0xFF8A9189),
    statusPlum: Color(0xFFC98CAC),
    statusAmber: Color(0xFFF0A03E),
    statusOlive: Color(0xFFC4A45B),
  );
}

/// Active-palette accessors. Call sites use these; the app flips the active
/// palette with [setDark] before building the themed subtree.
class AppColors {
  AppColors._();

  /// Which palette [AppColors.x] currently resolves against.
  static bool dark = false;

  static HelixPalette get _active => dark ? HelixPalette.dark : HelixPalette.light;

  static Color get bg => _active.bg;
  static Color get surface => _active.surface;
  static Color get surfaceSunk => _active.surfaceSunk;
  static Color get surfaceInverse => _active.surfaceInverse;
  static Color get text => _active.text;
  static Color get textSecondary => _active.textSecondary;
  static Color get textTertiary => _active.textTertiary;
  static Color get textInverse => _active.textInverse;
  static Color get line => _active.line;
  static Color get lineStrong => _active.lineStrong;

  static Color get brandNavy => HelixPalette.light.surfaceInverse; // brand moment, never flips
  static Color get accent => _active.accent;
  static Color get accentText => _active.accentText;
  static Color get accentPressed => _active.accentPressed;
  static Color get accentQuiet => _active.accentQuiet;
  static Color get onAccent => _active.onAccent;
  static Color get adminAccent => _active.adminAccent;
  static Color get adminAccentQuiet => _active.adminAccentQuiet;
  static Color get adminAccentPressed => _active.adminAccentPressed;
  static Color get onAdminAccent => _active.onAdminAccent;

  static Color get statusOk => _active.statusOk;
  static Color get statusDanger => _active.statusDanger;
  static Color get statusWarn => _active.statusWarn;
  static Color get statusWarnFill => _active.statusWarnFill;
  static Color get statusInfo => _active.statusInfo;
  static Color get statusNeutral => _active.statusNeutral;
  static Color get statusPlum => _active.statusPlum;
  static Color get statusAmber => _active.statusAmber;
  static Color get statusOlive => _active.statusOlive;

  /// Foreground tone for the strand accent. The raw strand fill is too light
  /// to use as an icon or label colour on paper — this is its AA-safe twin.
  static Color get accentFg => accentText;

  /// Foreground tone for the admin strand.
  static Color get adminAccentFg => adminAccent;

  // ── Materials (frosted chrome) ───────────────────────────────────────

  /// Translucent backing for navigation bar / tab bar (content scrolls under).
  static Color get frostChrome => surface.withValues(alpha: 0.88);
  static Color get frostSheet => surface.withValues(alpha: 0.92);
  static const double blurChrome = 20.0;
  static const double blurSheet = 16.0;

  static void setDark(bool value) => dark = value;
}

class AppSpace {
  AppSpace._();
  static const s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 24.0, s6 = 32.0, s7 = 48.0, s8 = 64.0;
  static const gutterPhone = 16.0;
  static const gutterAdmin = 24.0;
  static const cardPaddingPhone = 16.0;
  static const cardPaddingAdmin = 20.0;
}

class AppRadius {
  AppRadius._();
  static const control = 8.0;
  static const card = 12.0;
  static const sheet = 16.0;
  static const full = 999.0;
}

class AppTarget {
  AppTarget._();
  static const touchPhone = 56.0;
  static const touchAdmin = 64.0;
  static const chipPhone = 48.0;
  static const chipAdmin = 56.0;

  /// Minimum height for a non-interactive badge or status chip. These are not
  /// controls, so they follow the type scale rather than the touch-target
  /// floor — an interactive chip uses [chipPhone].
  static const badge = 32.0;

  /// Width of one swipe-revealed action.
  static const swipeAction = 88.0;
}

/// Type scale. Phone is the base; [adminScale] switches to the admin scale.
class AppType {
  AppType._();

  static const displayPhone = 30.0, displayAdmin = 36.0;
  static const titlePhone = 24.0, titleAdmin = 28.0;
  static const leadPhone = 19.0, leadAdmin = 22.0;
  static const bodyPhone = 16.0, bodyAdmin = 17.0;
  static const captionPhone = 13.0, captionAdmin = 14.0;

  static const fontDisplay = 'Barlow Semi Condensed';
  static const fontBody = 'Barlow';
  static const fontMono = 'IBMPlexMono';

  /// Body copy honours the platform text-size setting up to the WCAG 1.4.4
  /// ceiling of 200%. Chrome labels that live in fixed-height controls use
  /// [maxChromeTextScale] instead.
  static const maxTextScale = 2.0;

  /// Fixed-height chrome (tab labels, badge numerals, segmented labels).
  static const maxChromeTextScale = 1.3;
}

class AppMotion {
  AppMotion._();
  static const durPress = Duration(milliseconds: 120);
  static const durFade = Duration(milliseconds: 200);
  static const durSheet = Duration(milliseconds: 280);
  static const durHold = Duration(milliseconds: 2000); // policy B-06

  static const easeOut = Cubic(0.23, 1, 0.32, 1);
  static const easeInOut = Cubic(0.77, 0, 0.175, 1);
  static const easeStandard = Cubic(0.4, 0, 0.2, 1);

  /// Critically damped — the default for anything the user can touch. No
  /// overshoot, ~0.35 s to settle.
  static final springCritical = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 130,
    ratio: 1.0,
  );

  /// Under-damped — reserve for gestures that carried momentum (a flick, a
  /// throw, a release). ~0.3 s with a small overshoot.
  static final springBouncy = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 160,
    ratio: 0.8,
  );

  /// Sheets and drawers — a sheet settles fast and overshoots slightly.
  static final springSheet = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 220,
    ratio: 0.85,
  );

  /// Press/release on a control — quick, no overshoot.
  static final springSnappy = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 380,
    ratio: 1.0,
  );

  /// Scale applied to a control while it is held.
  static const pressScale = 0.975;
}

/// Which shell is active — picks the brand strand (the logo's twin strands).
enum Shell { driver, admin }

extension ShellAccent on Shell {
  Color get fill => this == Shell.driver ? AppColors.accent : AppColors.adminAccent;
  Color get textTone => this == Shell.driver ? AppColors.accentText : AppColors.adminAccent;
  Color get pressed => this == Shell.driver ? AppColors.accentPressed : AppColors.adminAccentPressed;
  Color get quiet => this == Shell.driver ? AppColors.accentQuiet : AppColors.adminAccentQuiet;
  Color get onFill => this == Shell.driver ? AppColors.onAccent : AppColors.onAdminAccent;
  bool get isAdmin => this == Shell.admin;
}

/// Admin shell scale (denser type, bigger targets). Driver = phone scale.
class AppScale {
  const AppScale.of(this.admin);
  final bool admin;

  double get gutter => admin ? AppSpace.gutterAdmin : AppSpace.gutterPhone;
  double get cardPadding => admin ? AppSpace.cardPaddingAdmin : AppSpace.cardPaddingPhone;
  double get touch => admin ? AppTarget.touchAdmin : AppTarget.touchPhone;
  double get chip => admin ? AppTarget.chipAdmin : AppTarget.chipPhone;
  double get display => admin ? AppType.displayAdmin : AppType.displayPhone;
  double get title => admin ? AppType.titleAdmin : AppType.titlePhone;
  double get lead => admin ? AppType.leadAdmin : AppType.leadPhone;
  double get body => admin ? AppType.bodyAdmin : AppType.bodyPhone;
  double get caption => admin ? AppType.captionAdmin : AppType.captionPhone;
  double get radiusControl => admin ? 12.0 : AppRadius.control;
  double get radiusSheet => admin ? 24.0 : AppRadius.sheet;
  double get tabBarHeight => admin ? 72.0 : 64.0;
}
