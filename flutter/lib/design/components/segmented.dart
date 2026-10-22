import 'package:flutter/material.dart';
import '../tokens.dart';
import 'text.dart';

class SegmentedOption<T> {
  const SegmentedOption(this.value, this.label, {this.badge});
  final T value;
  final String label;
  final int? badge;
}

/// Equal-width segmented control (Inbox, Review). Active = sunk fill + ink
/// weight; optional count badges only where the backend count is exact.
///
/// The selection fill snaps rather than cross-fades: a segmented control is a
/// radio group, and the change should read as a state change, not a
/// transition. Keyboard focus is available on every segment.
class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.options, required this.value, required this.onChanged});

  final List<SegmentedOption<T>> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceSunk,
          borderRadius: BorderRadius.circular(AppRadius.control),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(
          children: [
            for (final option in options)
              Expanded(
                child: _Segment(
                  option: option,
                  selected: option.value == value,
                  onTap: () => onChanged(option.value),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({required this.option, required this.selected, required this.onTap});

  final SegmentedOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      button: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.control - 2),
          splashColor: AppColors.accent.withValues(alpha: 0.12),
          highlightColor: Colors.transparent,
          child: Container(
            height: AppTarget.chipPhone,
            margin: const EdgeInsets.all(AppSpace.s1),
            decoration: BoxDecoration(
              color: selected ? AppColors.surface : Colors.transparent,
              borderRadius: BorderRadius.circular(AppRadius.control - 2),
              border: Border.all(color: selected ? AppColors.line : Colors.transparent),
            ),
            alignment: Alignment.center,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: HelixText.chrome(
                    option.label,
                    style: selected
                        ? TypeScale.bodyStrong(AppColors.text)
                        : TypeScale.body(AppColors.textSecondary),
                    maxLines: 1,
                    textAlign: TextAlign.center,
                  ),
                ),
                if (option.badge != null) ...[
                  const SizedBox(width: AppSpace.s2),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.accentQuiet : AppColors.surface,
                      borderRadius: BorderRadius.circular(AppRadius.full),
                    ),
                    child: HelixText.chrome(
                      '${option.badge}',
                      style: TypeScale.numeral(AppColors.accentText),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
