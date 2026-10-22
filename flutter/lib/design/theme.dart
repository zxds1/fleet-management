import 'dart:ui';
import 'package:flutter/material.dart';
import 'tokens.dart';

/// A translucent, blurred backing for chrome: nav bar, sheets, tab bar.
/// Content scrolls underneath; hierarchy comes from material depth, not shadows.
class FrostedSurface extends StatelessWidget {
  const FrostedSurface({
    super.key,
    required this.child,
    this.blur = AppColors.blurChrome,
    this.color,
  });

  final Widget child;
  final double blur;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          color: color ?? AppColors.frostChrome,
          child: child,
        ),
      ),
    );
  }
}

/// Builds the app themes from tokens. Light = "Daylight Field"; dark =
/// "Night Ops". Strand accents come from [ShellAccent], not from the theme.
///
/// The theme is built from an explicit [HelixPalette] rather than from the
/// global [AppColors] accessors, so a theme can never pick up the wrong
/// palette. The app flips the active palette with [AppColors.setDark] before
/// it builds the themed subtree.
class HelixTheme {
  HelixTheme._();

  static ThemeData light() => _base(HelixPalette.light, Brightness.light);

  static ThemeData dark() => _base(HelixPalette.dark, Brightness.dark);

  /// The theme for one shell. Material's own components (chips, switches,
  /// progress, FAB) read the colour scheme, so the admin shell gets a
  /// violet-seeded scheme and the driver shell a cyan-seeded one.
  static ThemeData forShell(Shell shell, Brightness brightness) {
    final palette = brightness == Brightness.dark ? HelixPalette.dark : HelixPalette.light;
    return _base(palette, brightness, shell: shell);
  }

  /// Re-colours an existing theme's scheme for a nested [Theme] — used by the
  /// admin shell so Material components follow the violet strand.
  static ThemeData restyle(ThemeData base, Shell shell, Brightness brightness) {
    final palette = brightness == Brightness.dark ? HelixPalette.dark : HelixPalette.light;
    return base.copyWith(colorScheme: _scheme(palette, brightness, shell));
  }

  static ThemeData _base(
    HelixPalette palette,
    Brightness brightness, {
    Shell shell = Shell.driver,
  }) {
    final base = ThemeData(
      brightness: brightness,
      useMaterial3: true,
      scaffoldBackgroundColor: palette.bg,
      colorScheme: _scheme(palette, brightness, shell),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: palette.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        iconTheme: IconThemeData(color: palette.text),
        titleTextStyle: TextStyle(
          fontFamily: AppType.fontDisplay,
          fontWeight: FontWeight.w700,
          fontSize: AppType.titlePhone,
          height: 1.15,
          color: palette.text,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: palette.surface.withValues(alpha: 0.88),
        indicatorColor: Colors.transparent,
        height: AppTarget.touchPhone,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: palette.surface.withValues(alpha: 0.92),
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
        ),
        dragHandleColor: palette.line,
        showDragHandle: true,
      ),
      dividerTheme: DividerThemeData(color: palette.line, thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: palette.surfaceInverse,
        contentTextStyle: TextStyle(
          fontFamily: AppType.fontBody,
          fontWeight: FontWeight.w400,
          fontSize: AppType.bodyPhone,
          height: 1.5,
          color: palette.textInverse,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: palette.surfaceSunk,
        selectedColor: palette.accentQuiet,
        side: BorderSide(color: palette.line),
        labelStyle: TextStyle(
          fontFamily: AppType.fontBody,
          fontSize: AppType.captionPhone,
          color: palette.text,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? palette.onAccent : palette.textSecondary,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? palette.accent : palette.surfaceSunk,
        ),
        trackOutlineColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? palette.accent : palette.lineStrong,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: palette.accent,
        linearTrackColor: palette.surfaceSunk,
        circularTrackColor: palette.surfaceSunk,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: palette.accent,
        foregroundColor: palette.onAccent,
        elevation: 0,
        focusElevation: 0,
        hoverElevation: 0,
        highlightElevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card)),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: palette.textSecondary,
        textColor: palette.text,
      ),
      iconTheme: IconThemeData(color: palette.text),
      splashFactory: InkSparkle.splashFactory,
    );

    TextStyle display(Color color, double size) => TextStyle(
          fontFamily: AppType.fontDisplay,
          fontWeight: FontWeight.w700,
          fontSize: size,
          height: 1.1,
          letterSpacing: -0.01,
          color: color,
        );
    TextStyle title(Color color, double size) => TextStyle(
          fontFamily: AppType.fontDisplay,
          fontWeight: FontWeight.w700,
          fontSize: size,
          height: 1.15,
          letterSpacing: -0.01,
          color: color,
        );
    TextStyle lead(Color color, double size) => TextStyle(
          fontFamily: AppType.fontBody,
          fontWeight: FontWeight.w600,
          fontSize: size,
          height: 1.3,
          color: color,
        );
    TextStyle body(Color color, double size) => TextStyle(
          fontFamily: AppType.fontBody,
          fontWeight: FontWeight.w400,
          fontSize: size,
          height: 1.5,
          color: color,
        );
    TextStyle caption(Color color, double size) => TextStyle(
          fontFamily: AppType.fontBody,
          fontWeight: FontWeight.w500,
          fontSize: size,
          height: 1.35,
          color: color,
        );
    TextStyle mono(Color color, double size) => TextStyle(
          fontFamily: AppType.fontMono,
          fontWeight: FontWeight.w500,
          fontSize: size,
          height: 1.35,
          color: color,
        );

    final textTheme = TextTheme(
      displaySmall: display(palette.text, AppType.displayPhone),
      headlineMedium: display(palette.text, AppType.displayPhone),
      titleLarge: title(palette.text, AppType.titlePhone),
      titleMedium: lead(palette.text, AppType.leadPhone),
      bodyLarge: body(palette.text, AppType.bodyPhone),
      bodyMedium: body(palette.textSecondary, AppType.bodyPhone),
      bodySmall: caption(palette.textSecondary, AppType.captionPhone),
      labelLarge: lead(palette.text, AppType.bodyPhone),
      labelMedium: mono(palette.textSecondary, AppType.captionPhone),
      labelSmall: mono(palette.textTertiary, AppType.captionPhone),
    );

    return base.copyWith(textTheme: textTheme);
  }

  static ColorScheme _scheme(HelixPalette p, Brightness brightness, Shell shell) {
    final admin = shell == Shell.admin;
    final seed = admin ? p.adminAccent : p.accent;
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return scheme.copyWith(
      primary: admin ? p.adminAccent : p.accent,
      onPrimary: admin ? p.onAdminAccent : p.onAccent,
      primaryContainer: admin ? p.adminAccentQuiet : p.accentQuiet,
      onPrimaryContainer: admin ? p.adminAccent : p.accentText,
      secondary: admin ? p.accent : p.adminAccent,
      onSecondary: admin ? p.onAccent : p.onAdminAccent,
      secondaryContainer: admin ? p.accentQuiet : p.adminAccentQuiet,
      onSecondaryContainer: admin ? p.accentText : p.adminAccent,
      surface: p.surface,
      onSurface: p.text,
      onSurfaceVariant: p.textSecondary,
      surfaceContainerHighest: p.surfaceSunk,
      surfaceContainerHigh: p.surfaceSunk,
      surfaceContainerLow: p.surface,
      surfaceContainerLowest: p.bg,
      outline: p.line,
      outlineVariant: p.line,
      error: p.statusDanger,
      onError: p.textInverse,
      shadow: Colors.transparent,
      scrim: p.bg.withValues(alpha: 0.55),
    );
  }
}
