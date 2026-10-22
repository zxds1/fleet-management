import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Training roster: per-driver completion status.
class TrainingRosterScreen extends ConsumerWidget {
  const TrainingRosterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('training.roster'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: PagedList<Map<String, dynamic>>(
        emptyMessage: strings.t('drivers.empty'),
        loadMore: (cursor) async {
          try {
            return await ref.read(repositoryProvider).page('training/roster', cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) {
          final status = row['status']?.toString() ?? 'NOT_STARTED';
          return ListTile(
            title: HelixText(row['driver_name']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
            subtitle: HelixText(
              '${row['lesson_title'] ?? ''} · ${Fmt.dateTime(DateTime.tryParse(row['completed_at']?.toString() ?? ''))}',
              style: TypeScale.caption(AppColors.textSecondary),
            ),
            trailing: HelixChip(
              label: strings.t('training.status${status[0]}${status.substring(1).toLowerCase()}'),
              color: status == 'COMPLETED' ? AppColors.statusOk : AppColors.statusNeutral,
            ),
          );
        },
      ),
    );
  }
}
