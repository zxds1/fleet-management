import 'package:flutter/material.dart';
import '../tokens.dart';
import 'text.dart';

/// Card: surface fill + hairline. Elevation is a tone step, never a shadow.
/// Selected state changes the fill, not a decorative border.
class HelixCard extends StatelessWidget {
  const HelixCard({
    super.key,
    required this.child,
    this.selected = false,
    this.onTap,
    this.padding = AppSpace.s4,
    this.semanticsLabel,
    this.heroTag,
  });

  final Widget child;
  final bool selected;
  final VoidCallback? onTap;
  final double padding;
  final String? semanticsLabel;
  final String? heroTag;

  @override
  Widget build(BuildContext context) {
    // The card is a Material, not a decorated box: a ListTile or a TextField
    // inside it paints its ink on the nearest Material, so a transparent one
    // would hide the splash behind the card's own background.
    final content = Semantics(
      label: semanticsLabel,
      container: semanticsLabel != null,
      child: Material(
        color: selected ? AppColors.accentQuiet : AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
          side: BorderSide(color: AppColors.line),
        ),
        child: Padding(
          padding: EdgeInsets.all(padding),
          child: heroTag == null ? child : Hero(tag: heroTag!, child: child),
        ),
      ),
    );
    if (onTap == null) return content;
    return Semantics(
      button: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.card),
          splashColor: AppColors.accent.withValues(alpha: 0.12),
          highlightColor: Colors.transparent,
          child: content,
        ),
      ),
    );
  }
}

/// Grouped section with a lead-weight header and hairline separators.
class Section extends StatelessWidget {
  const Section({
    super.key,
    required this.title,
    this.subtitle,
    required this.children,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: HelixText(title, style: TypeScale.lead(AppColors.text))),
            ?trailing,
          ],
        ),
        if (subtitle != null) ...[
          const SizedBox(height: AppSpace.s1),
          HelixText(subtitle!, style: TypeScale.caption(AppColors.textSecondary)),
        ],
        const SizedBox(height: AppSpace.s3),
        Material(
          color: AppColors.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.card),
            side: BorderSide(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) Divider(height: 1, color: AppColors.line),
                children[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Key-value data row with tabular mono numerals, right-aligned.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow({super.key, required this.label, required this.value, this.mono = true});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpace.s2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: HelixText(label, style: TypeScale.caption(AppColors.textSecondary))),
          const SizedBox(width: AppSpace.s3),
          Flexible(
            child: HelixText(
              value,
              style: mono ? TypeScale.mono(AppColors.text) : TypeScale.body(AppColors.text),
              textAlign: TextAlign.right,
              maxLines: 2,
            ),
          ),
        ],
      ),
    );
  }
}
