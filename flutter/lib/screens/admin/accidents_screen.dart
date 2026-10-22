import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Admin accident queue (tenant scope, ownScope=false).
class AdminAccidentsScreen extends ConsumerWidget {
  const AdminAccidentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final canAck = ref.watch(sessionProvider).permissions.contains('accident:acknowledge');
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('admin.accidents'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: PagedList<Map<String, dynamic>>(
        emptyMessage: strings.t('admin.emptyAccidents'),
        loadMore: (cursor) async {
          try {
            return await ref.read(repositoryProvider).accidents(ownScope: false, cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) {
          final mayday = row['mayday'] == true;
          return ListTile(
            leading: mayday
                ? HelixChip(label: strings.t('admin.mayday'), color: AppColors.statusDanger, glyph: '▲')
                : HelixChip(label: row['severity']?.toString() ?? '', color: AppColors.statusNeutral),
            title: HelixText(row['reference']?.toString() ?? '', style: TypeScale.mono(AppColors.text, size: 13)),
            subtitle: HelixText(
              '${strings.t('detail.tierShort', {'n': '${row['escalation_tier'] ?? 0}'})} · ${row['location_label'] ?? ''}',
              style: TypeScale.caption(AppColors.textSecondary),
            ),
            trailing: row['acknowledged_at'] != null || !canAck
                ? null
                : Icon(Icons.circle_rounded, size: 10, color: AppColors.statusDanger),
            onTap: () => context.push('/admin/accidents/${row['accident_id']}'),
          );
        },
      ),
    );
  }
}
