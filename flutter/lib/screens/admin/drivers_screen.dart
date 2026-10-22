import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Driver roster with status filter + inline create (email, name).
class DriversScreen extends ConsumerWidget {
  const DriversScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('drivers.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: PagedList<Map<String, dynamic>>(
        emptyMessage: strings.t('drivers.empty'),
        loadMore: (cursor) async {
          try {
            return await ref.read(repositoryProvider).page('drivers', cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) => ListTile(
          title: HelixText(row['full_name']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
          subtitle: HelixText(
            '${row['email'] ?? ''} · ${Fmt.dateTime(DateTime.tryParse(row['last_login_at']?.toString() ?? ''))}',
            style: TypeScale.caption(AppColors.textSecondary),
          ),
          trailing: HelixChip(
            label: strings.t('drivers.${row['status']?.toString().toLowerCase() ?? 'active'}'),
            color: row['status'] == 'SUSPENDED' ? AppColors.statusDanger : AppColors.statusOk,
          ),
          onTap: () => context.push('/admin/drivers/${row['user_id']}'),
        ),
      ),
    );
  }
}
