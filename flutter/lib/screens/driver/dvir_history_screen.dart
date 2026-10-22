import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../../i18n/strings.dart';

/// The driver's own DVIR history (cursor-paginated).
class DvirHistoryScreen extends ConsumerWidget {
  const DvirHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = Strings.of(context);
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('forms.titleInspect'), style: TypeScale.title(AppColors.text))),
      body: PagedList<Map<String, dynamic>>(
        emptyMessage: strings.t('admin.emptyDvir'),
        loadMore: (cursor) async {
          try {
            return await ref.read(repositoryProvider).page('inspections/me', cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) => ListTile(
          title: HelixText(row['template_label']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
          subtitle: HelixText(
            '${row['vehicle_plate'] ?? ''} · ${row['status'] ?? ''} · ${row['defect_count'] ?? 0} defects',
            style: TypeScale.caption(AppColors.textSecondary),
          ),
          trailing: row['quarantined'] == true ? HelixChip(label: '!', color: AppColors.statusDanger) : null,
        ),
      ),
    );
  }
}

