import 'package:flutter/material.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

/// Caption chips marking cached data / queued writes.
class OfflineTag extends StatelessWidget {
  const OfflineTag({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.s2, vertical: AppSpace.s1),
      decoration: BoxDecoration(
        color: AppColors.surfaceSunk,
        borderRadius: BorderRadius.circular(AppRadius.control - 4),
        border: Border.all(color: AppColors.line),
      ),
      child: HelixText(
        label ?? Strings.of(context).t('state.offlineCopy'),
        style: TypeScale.caption(AppColors.textSecondary),
      ),
    );
  }
}

class PendingChip extends StatelessWidget {
  const PendingChip({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.s2, vertical: AppSpace.s1),
      decoration: BoxDecoration(
        color: AppColors.accentQuiet,
        borderRadius: BorderRadius.circular(AppRadius.control - 4),
      ),
      child: HelixText(
        label ?? Strings.of(context).t('state.pending'),
        style: TypeScale.caption(AppColors.accentText),
      ),
    );
  }
}
