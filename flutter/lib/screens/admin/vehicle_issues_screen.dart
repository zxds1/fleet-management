import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Vehicle issues: list + inline report form (category / severity / description).
class VehicleIssuesScreen extends ConsumerStatefulWidget {
  const VehicleIssuesScreen({super.key, required this.vehicleId});

  final String vehicleId;

  @override
  ConsumerState<VehicleIssuesScreen> createState() => _VehicleIssuesScreenState();
}

class _VehicleIssuesScreenState extends ConsumerState<VehicleIssuesScreen> {
  final _description = TextEditingController();
  String _category = 'MECHANICAL';
  String _severity = 'MEDIUM';

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _report() async {
    try {
      await ref.read(repositoryProvider).reportVehicleIssue(widget.vehicleId, {
        'category': _category,
        'severity': _severity,
        'description': _description.text.trim(),
      });
      if (!mounted) return;
      Navigator.of(context).pop();
      ref.invalidate(_issuesProvider(widget.vehicleId));
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('vehicle.issues'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: PagedList<Map<String, dynamic>>(
        emptyMessage: strings.t('vehicle.noIssues'),
        loadMore: (cursor) async {
          try {
            return await ref.read(repositoryProvider).page('vehicles/${widget.vehicleId}/issues', cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) => HelixCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  HelixChip(
                    label: strings.t('issue.${row['category']?.toString().toLowerCase()}'),
                    color: AppColors.statusNeutral,
                  ),
                  const Spacer(),
                  HelixChip(
                    label: strings.t('issue.${row['severity']?.toString().toLowerCase()}'),
                    color: row['severity'] == 'HIGH' ? AppColors.statusDanger : AppColors.statusWarn,
                  ),
                ],
              ),
              const SizedBox(height: AppSpace.s2),
              HelixText(row['description']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
              const SizedBox(height: AppSpace.s1),
              HelixText(Fmt.dateTime(DateTime.tryParse(row['created_at']?.toString() ?? '')), style: TypeScale.caption(AppColors.textSecondary)),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.adminAccent,
        onPressed: () async {
          await SheetHost.show(
            context: context,
            title: strings.t('vehicle.reportIssue'),
            child: Padding(
              padding: const EdgeInsets.all(AppSpace.s5),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: InputDecoration(filled: true, fillColor: AppColors.surfaceSunk),
                    items: ['MECHANICAL', 'ELECTRICAL', 'TYRE', 'BODY', 'OTHER']
                        .map((c) => DropdownMenuItem(value: c, child: HelixText(c, style: TypeScale.body(AppColors.text))))
                        .toList(),
                    onChanged: (v) => _category = v ?? 'MECHANICAL',
                  ),
                  const SizedBox(height: AppSpace.s3),
                  DropdownButtonFormField<String>(
                    initialValue: _severity,
                    decoration: InputDecoration(filled: true, fillColor: AppColors.surfaceSunk),
                    items: ['LOW', 'MEDIUM', 'HIGH']
                        .map((s) => DropdownMenuItem(value: s, child: HelixText(s, style: TypeScale.body(AppColors.text))))
                        .toList(),
                    onChanged: (v) => _severity = v ?? 'MEDIUM',
                  ),
                  const SizedBox(height: AppSpace.s3),
                  Field(label: strings.t('issue.description'), controller: _description, maxLines: 3),
                  const SizedBox(height: AppSpace.s4),
                  StrandButton(label: strings.t('actions.submit'), shell: Shell.admin, onPressed: _report),
                ],
              ),
            ),
          );
        },
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}

final _issuesProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, vehicleId) async {
  return {'vehicle_id': vehicleId};
});
