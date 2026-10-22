import 'package:flutter/material.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

enum GaugePosition { empty, quarter, half, threeQuarters, full }

const _gaugeLabels = {
  GaugePosition.empty: 'E',
  GaugePosition.quarter: '¼',
  GaugePosition.half: '½',
  GaugePosition.threeQuarters: '¾',
  GaugePosition.full: 'F',
};

String gaugeApiValue(GaugePosition p) => switch (p) {
      GaugePosition.empty => 'EMPTY',
      GaugePosition.quarter => 'QUARTER',
      GaugePosition.half => 'HALF',
      GaugePosition.threeQuarters => 'THREE_QUARTERS',
      GaugePosition.full => 'FULL',
    };

/// Required fuel-gauge radiogroup — NO default (guard-carried). Glyph + letter.
class GaugePicker extends StatelessWidget {
  const GaugePicker({super.key, required this.value, required this.onChanged});

  final GaugePosition? value;
  final ValueChanged<GaugePosition> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: Strings.of(context).t('gauge.label'),
      child: Row(
        children: [
          for (final position in GaugePosition.values)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.s1),
                child: _GaugeCell(
                  position: position,
                  selected: value == position,
                  onTap: () => onChanged(position),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _GaugeCell extends StatelessWidget {
  const _GaugeCell({required this.position, required this.selected, required this.onTap});

  final GaugePosition position;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      button: true,
      label: _gaugeLabels[position]!,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.control),
          splashColor: AppColors.accent.withValues(alpha: 0.12),
          highlightColor: Colors.transparent,
          child: Container(
            height: AppTarget.chipPhone,
            decoration: BoxDecoration(
              color: selected ? AppColors.accentQuiet : AppColors.surfaceSunk,
              borderRadius: BorderRadius.circular(AppRadius.control),
              border: Border.all(color: selected ? AppColors.accentText : AppColors.line),
            ),
            alignment: Alignment.center,
            child: HelixText.chrome(
              _gaugeLabels[position]!,
              style: TypeScale.mono(
                selected ? AppColors.accentText : AppColors.textSecondary,
                size: AppType.leadPhone,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Fuel-gauge fill level (0..1) drawn as a hairline tank — used in detail rows.
/// The fill colour carries the level: a nearly empty tank must not read as
/// healthy, so it shifts to warn at a quarter and to danger at empty.
class GaugeBar extends StatelessWidget {
  const GaugeBar({super.key, required this.gauge});

  final String? gauge;

  static const _barWidth = 72.0;

  static double? fraction(String? gauge) => switch (gauge?.toUpperCase()) {
        'EMPTY' => 0.05,
        'QUARTER' => 0.28,
        'HALF' => 0.5,
        'THREE_QUARTERS' => 0.74,
        'FULL' => 1.0,
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final level = fraction(gauge);
    final fill = level == null
        ? AppColors.textTertiary
        : level <= 0.05
            ? AppColors.statusDanger
            : level < 0.3
                ? AppColors.statusWarn
                : AppColors.statusOk;
    return Container(
      height: 10,
      width: _barWidth,
      decoration: BoxDecoration(
        color: AppColors.surfaceSunk,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.line),
      ),
      child: Align(
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(
          widthFactor: level ?? 0,
          child: Container(
            decoration: BoxDecoration(
              color: fill,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
          ),
        ),
      ),
    );
  }
}
