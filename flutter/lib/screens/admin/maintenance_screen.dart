import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// Maintenance records + inline work-order form.
class MaintenanceScreen extends ConsumerStatefulWidget {
  const MaintenanceScreen({super.key});

  @override
  ConsumerState<MaintenanceScreen> createState() => _MaintenanceScreenState();
}

class _MaintenanceScreenState extends ConsumerState<MaintenanceScreen> {
  Future<void> _openWorkOrder() async {
    if (!adminCan(ref, 'maintenance:record')) return;
    final strings = context.s;
    await SheetHost.show<void>(
      context: context,
      title: strings.t('maintenance.record'),
      child: const _WorkOrderForm(),
    );
    if (!mounted) return;
    ref.invalidate(adminMaintenanceProvider);
    bumpAdminRevision(ref, 'maintenance');
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final canRecord = ref.watch(sessionProvider).permissions.contains('maintenance:record');
    final revision = ref.watch(adminRevisionProvider('maintenance'));
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('maintenance.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: PagedList<Map<String, dynamic>>(
        key: ValueKey('maintenance-$revision'),
        emptyMessage: strings.t('maintenance.empty'),
        loadMore: (cursor) async {
          try {
            if (cursor == null) {
              return await ref.read(adminMaintenanceProvider.future);
            }
            return await ref.read(repositoryProvider).page('maintenance', cursor: cursor);
          } on HelixError catch (e) {
            throw HelixErrorLike(strings.error(e.code), actionLabel: strings.t(e.catalogue.i18nKey));
          }
        },
        itemBuilder: (context, row) => HelixCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HelixText(row['task_code']?.toString() ?? '', style: TypeScale.bodyStrong(AppColors.text)),
              const SizedBox(height: AppSpace.s1),
              HelixText(
                '${row['vendor'] ?? ''} · ${Fmt.moneyParts(adminNum(row['cost']))} · ${Fmt.date(Fmt.parseTimestamp(row['performed_at']?.toString()))}',
                style: TypeScale.caption(AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: canRecord
          ? FloatingActionButton(
              backgroundColor: AppColors.adminAccent,
              foregroundColor: AppColors.onAdminAccent,
              onPressed: _openWorkOrder,
              child: const Icon(Icons.add_rounded),
            )
          : null,
    );
  }
}

/// The work-order form. It owns the write so the server's per-field errors
/// can be rendered under the input that caused them, and it pops the SHEET
/// (not the screen) when the work order is saved.
class _WorkOrderForm extends ConsumerStatefulWidget {
  const _WorkOrderForm();

  @override
  ConsumerState<_WorkOrderForm> createState() => _WorkOrderFormState();
}

class _WorkOrderFormState extends ConsumerState<_WorkOrderForm> {
  final _task = TextEditingController();
  final _vendor = TextEditingController();
  final _cost = TextEditingController();
  final _notes = TextEditingController();

  String? _vehicleId;
  bool _busy = false;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    _task.dispose();
    _vendor.dispose();
    _cost.dispose();
    _notes.dispose();
    super.dispose();
  }

  String? _errorFor(String field) => _fieldErrors[field];

  Future<void> _submit() async {
    final strings = context.s;
    if (_vehicleId == null) {
      setState(() => _fieldErrors = {'vehicle_id': strings.error('VEHICLE_REQUIRED')});
      return;
    }
    if (_task.text.trim().isEmpty) {
      setState(() => _fieldErrors = {'task_code': strings.error('VALIDATION_ERROR')});
      return;
    }
    setState(() {
      _busy = true;
      _fieldErrors = const {};
    });
    try {
      await ref.read(repositoryProvider).createMaintenance({
        'vehicle_id': _vehicleId,
        'task_code': _task.text.trim(),
        // The server requires when the work was performed; default to now.
        'performed_at': DateTime.now().toUtc().toIso8601String(),
        if (_vendor.text.trim().isNotEmpty) 'vendor': _vendor.text.trim(),
        if (_cost.text.trim().isNotEmpty) 'cost': double.tryParse(_cost.text.trim()),
        'currency': 'KES',
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      Navigator.of(context, rootNavigator: true).pop();
    } on HelixError catch (e) {
      if (!mounted) return;
      setState(() => _fieldErrors = e.fieldErrors);
      showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final vehiclesAsync = ref.watch(adminVehiclesProvider);
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          HelixText(strings.t('maintenance.vehicleId'), style: TypeScale.caption(AppColors.textSecondary)),
          const SizedBox(height: AppSpace.s2),
          vehiclesAsync.when(
            loading: () => const SizedBox(height: 48),
            error: (e, _) => HelixText(
              strings.error('UNKNOWN'),
              style: TypeScale.caption(AppColors.statusDanger),
            ),
            data: (vehicles) {
              final items = vehicles
                  .where((v) => v['id'] != null)
                  .map(
                    (v) => DropdownMenuItem<String>(
                      value: v['id'].toString(),
                      child: HelixText(
                        '${v['license_plate'] ?? ''} · ${v['make'] ?? ''} ${v['model'] ?? ''}'.trim(),
                        style: TypeScale.body(AppColors.text),
                      ),
                    ),
                  )
                  .toList();
              final selected = items.any((i) => i.value == _vehicleId) ? _vehicleId : null;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: selected,
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: AppColors.surfaceSunk,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
                      errorText: _errorFor('vehicle_id'),
                    ),
                    items: items,
                    onChanged: _busy
                        ? null
                        : (v) => setState(() {
                              _vehicleId = v;
                              _fieldErrors = {..._fieldErrors}..remove('vehicle_id');
                            }),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: AppSpace.s3),
          Field(
            label: strings.t('maintenance.taskId'),
            controller: _task,
            required: true,
            errorText: _errorFor('task_code'),
          ),
          const SizedBox(height: AppSpace.s3),
          Field(
            label: strings.t('maintenance.vendor'),
            controller: _vendor,
            errorText: _errorFor('vendor'),
          ),
          const SizedBox(height: AppSpace.s3),
          Field(
            label: strings.t('maintenance.cost'),
            controller: _cost,
            errorText: _errorFor('cost'),
          ),
          const SizedBox(height: AppSpace.s3),
          Field(
            label: strings.t('forms.notes'),
            controller: _notes,
            maxLines: 2,
            errorText: _errorFor('notes'),
          ),
          const SizedBox(height: AppSpace.s4),
          StrandButton(
            label: strings.t('maintenance.record'),
            shell: Shell.admin,
            busy: _busy,
            onPressed: _busy ? null : _submit,
          ),
        ],
      ),
    );
  }
}
