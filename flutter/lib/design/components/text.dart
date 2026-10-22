import 'package:flutter/material.dart';
import '../tokens.dart';

/// All app text goes through here — the type scale and the text-scale clamp are
/// enforced in one place.
///
/// Body copy honours the platform text-size setting up to
/// [AppType.maxTextScale] (200%, the WCAG 1.4.4 ceiling). Copy that lives in a
/// fixed-height control (button, tab bar, segmented control, badge) uses
/// [HelixText.chrome], which clamps to [AppType.maxChromeTextScale] so the
/// control cannot overflow.
class HelixText extends StatelessWidget {
  const HelixText(
    this.text, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
    this.semanticsLabel,
    this.textAlign,
    this.maxScale,
  });

  /// Chrome copy: fixed-height containers.
  const HelixText.chrome(
    this.text, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
    this.semanticsLabel,
    this.textAlign,
  }) : maxScale = AppType.maxChromeTextScale;

  final String text;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;
  final String? semanticsLabel;
  final TextAlign? textAlign;
  final double? maxScale;

  @override
  Widget build(BuildContext context) {
    final ceiling = maxScale ?? AppType.maxTextScale;
    return Semantics(
      label: semanticsLabel,
      child: Text(
        text,
        style: style,
        maxLines: maxLines,
        overflow: overflow ?? (maxLines == null ? TextOverflow.visible : TextOverflow.ellipsis),
        textAlign: textAlign,
        textScaler: MediaQuery.textScalerOf(context).clamp(
          minScaleFactor: 1.0,
          maxScaleFactor: ceiling,
        ),
      ),
    );
  }
}

/// Convenience styles bound to the phone scale (the base). Admin-scale
/// screens use HelixText with explicit sizes from their AppScale.
class TypeScale {
  TypeScale._();

  static TextStyle display(Color c) => TextStyle(
        fontFamily: AppType.fontDisplay,
        fontWeight: FontWeight.w700,
        fontSize: AppType.displayPhone,
        height: 1.1,
        letterSpacing: -0.015,
        color: c,
      );
  static TextStyle title(Color c) => TextStyle(
        fontFamily: AppType.fontDisplay,
        fontWeight: FontWeight.w700,
        fontSize: AppType.titlePhone,
        height: 1.15,
        letterSpacing: -0.01,
        color: c,
      );
  static TextStyle lead(Color c) => TextStyle(
        fontFamily: AppType.fontBody,
        fontWeight: FontWeight.w600,
        fontSize: AppType.leadPhone,
        height: 1.3,
        color: c,
      );
  static TextStyle body(Color c) => TextStyle(
        fontFamily: AppType.fontBody,
        fontWeight: FontWeight.w400,
        fontSize: AppType.bodyPhone,
        height: 1.5,
        color: c,
      );
  static TextStyle bodyStrong(Color c) => TextStyle(
        fontFamily: AppType.fontBody,
        fontWeight: FontWeight.w600,
        fontSize: AppType.bodyPhone,
        height: 1.5,
        color: c,
      );
  static TextStyle caption(Color c) => TextStyle(
        fontFamily: AppType.fontBody,
        fontWeight: FontWeight.w500,
        fontSize: AppType.captionPhone,
        height: 1.4,
        color: c,
      );
  static TextStyle button(Color c) => TextStyle(
        fontFamily: AppType.fontBody,
        fontWeight: FontWeight.w600,
        fontSize: AppType.bodyPhone,
        height: 1.2,
        color: c,
      );
  static TextStyle mono(Color c, {double size = AppType.bodyPhone}) => TextStyle(
        fontFamily: AppType.fontMono,
        fontWeight: FontWeight.w500,
        fontSize: size,
        height: 1.3,
        color: c,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  /// Numerals inside chrome (badge counts, gauge readouts). Sized off the
  /// scale's caption step rather than an ad-hoc size.
  static TextStyle numeral(Color c) => mono(c, size: AppType.captionPhone);
}
