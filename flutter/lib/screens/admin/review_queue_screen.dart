import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/segmented.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Review queue: Shifts | Inspections | Fuel with status filters preserving
/// scroll, worst-severity badges, and the statement-import entry.
class ReviewQueueScreen extends ConsumerStatefulWidget {
  const ReviewQueueScreen({super.key});

  @override
  ConsumerState<ReviewQueueScreen> createState() => _ReviewQueueScreenState();
}

class _ReviewQueueScreenState extends ConsumerState<ReviewQueueScreen> {
  String _segment = 'shifts';

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('tabs.review'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpace.s4),
            child: Segmented<String>(
              value: _segment,
              onChanged: (v) => setState(() => _segment = v),
              options: [
                SegmentedOption('shifts', strings.t('review.shifts')),
                SegmentedOption('inspections', strings.t('review.inspections')),
                SegmentedOption('fuel', strings.t('review.fuel')),
              ],
            ),
          ),
          Expanded(
            child: switch (_segment) {
              'shifts' => const _ShiftsList(),
              'inspections' => const _InspectionsList(),
              'fuel' => const _FuelList(),
              _ => const SizedBox.shrink(),
            },
          ),
        ],
      ),
    );
  }
}

class _ShiftsList extends ConsumerWidget {
  const _ShiftsList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return PagedList<Map<String, dynamic>>(
      emptyMessage: strings.t('shifts.empty'),
      loadMore: (cursor) async {
        try {
          return await ref.read(repositoryProvider).page(
            'shifts/verification-inbox',
            cursor: cursor,
            query: {'verification_status': 'PENDING'},
          );
        } on HelixError catch (e) {
          throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
        }
      },
      itemBuilder: (context, row) => ListTile(
        title: HelixText(row['driver_name']?.toString() ?? row['driver_id']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
        subtitle: HelixText(
          '${row['vehicle_plate'] ?? ''} · ${row['operational_date'] ?? ''}',
          style: TypeScale.caption(AppColors.textSecondary),
        ),
        trailing: HelixChip(
          label: strings.t('shifts.${row['verification_status'] ?? 'PENDING'}'),
          color: AppColors.statusWarn,
        ),
        onTap: () => context.push('/admin/shifts/${row['shift_id']}'),
      ),
    );
  }
}

class _InspectionsList extends ConsumerWidget {
  const _InspectionsList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return PagedList<Map<String, dynamic>>(
      emptyMessage: strings.t('admin.emptyDvir'),
      loadMore: (cursor) async {
        try {
          return await ref.read(repositoryProvider).page(
            'inspections',
            cursor: cursor,
            query: {'state': 'SUBMITTED'},
          );
        } on HelixError catch (e) {
          throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
        }
      },
      itemBuilder: (context, row) {
        final quarantined = row['quarantined'] == true;
        return ListTile(
          title: HelixText(row['template_label']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
          subtitle: HelixText(
            '${row['vehicle_plate'] ?? ''} · ${row['status'] ?? ''} · ${row['defect_count'] ?? 0} defects',
            style: TypeScale.caption(AppColors.textSecondary),
          ),
          trailing: quarantined ? HelixChip(label: '✕', color: AppColors.statusPlum) : null,
          onTap: () => context.push('/admin/inspections/${row['inspection_id']}'),
        );
      },
    );
  }
}

class _FuelList extends ConsumerWidget {
  const _FuelList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return Column(
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            icon: Icon(Icons.upload_file_rounded, color: AppColors.adminAccent),
            label: HelixText(strings.t('importer.submit'), style: TypeScale.button(AppColors.adminAccent)),
            onPressed: () => context.push('/admin/import-statement'),
          ),
        ),
        Expanded(
          child: PagedList<Map<String, dynamic>>(
            emptyMessage: strings.t('admin.emptyFuel'),
            loadMore: (cursor) async {
              try {
                return await ref.read(repositoryProvider).page(
                  'fuel/reconciliation-inbox',
                  cursor: cursor,
                  query: {'verified': 'false'},
                );
              } on HelixError catch (e) {
                throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
              }
            },
            itemBuilder: (context, row) {
              final confidence = (row['confidence_score'] as num?)?.toDouble();
              final flagged = confidence != null && confidence < 0.7; // OCR_CONFIDENCE_THRESHOLD
              return ListTile(
                title: HelixText(row['driver_name']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
                subtitle: HelixText(
                  '${Fmt.moneyParts(row['amount_spent'] as num?)} · ${row['liters_pumped'] ?? ''} L · ${row['vehicle_plate'] ?? ''}',
                  style: TypeScale.caption(AppColors.textSecondary),
                ),
                trailing: flagged ? HelixChip(label: '${(confidence * 100).round()}%', color: AppColors.statusWarn) : null,
                onTap: () => context.push('/admin/fuel/${row['fuel_purchase_id']}'),
              );
            },
          ),
        ),
      ],
    );
  }
}

