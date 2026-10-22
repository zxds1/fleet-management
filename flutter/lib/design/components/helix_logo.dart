import 'package:flutter/material.dart';

/// The Helix brand mark.
///
/// The artwork is the single source of truth: `assets/brand/helix_mark.png` is
/// generated from `assets/brand/helix_source.png` by
/// `tool/generate_brand_assets.py`, and the same generator produces the
/// launcher icons. Nothing here draws the logo — it composes the real mark on
/// the shape the use case calls for.
class HelixLogo extends StatelessWidget {
  const HelixLogo({super.key, this.size = 88, this.shape = LogoShape.roundedSquare});

  final double size;

  /// The badge shape. A squircle for the brand tile; a circle where the mark
  /// has to read as a round spot.
  final LogoShape shape;

  static const navy = Color(0xFF0F172A);

  static const asset = 'assets/brand/helix_mark.png';

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Helix',
      image: true,
      child: SizedBox(
        width: size,
        height: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: navy,
            borderRadius: shape == LogoShape.circle
                ? BorderRadius.circular(size / 2)
                : BorderRadius.circular(size * 0.24),
          ),
          child: ClipRRect(
            borderRadius: shape == LogoShape.circle
                ? BorderRadius.circular(size / 2)
                : BorderRadius.circular(size * 0.24),
            child: Padding(
              padding: EdgeInsets.all(size * 0.16),
              child: Image.asset(
                asset,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Where a brand mark appears.
enum LogoShape {
  /// The brand tile: a squircle.
  roundedSquare,

  /// A round spot — the privacy shield and other compact brand places.
  circle,
}
