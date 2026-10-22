import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// One vehicle: the master data the server holds, and the three fields
/// `PATCH /vehicles/:id` actually applies — status, operational flag and
/// notes. Everything else is read-only master data.
class VehicleDetailScreen extends ConsumerStatefulWidget {
  const VehicleDetailScreen({super.key, required this.vehicleId});

  final String vehicleId;

  @override
  ConsumerState<VehicleDetailScreen> createState() => _VehicleDetailScreenState();
}

class _VehicleDetailScreenState extends ConsumerState<VehicleDetailScreen> {
  bool _editing = false;
  bool _busy = false;
  String _status = 'AVAILABLE';
  bool _operational = true;
  late final TextEditingController _notes;
  String? _nonOperationalReason;

  @override
  void initState() {
    super.initState();
    _notes = TextEditingController();
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await ref.read(repositoryProvider).updateVehicle(widget.vehicleId, {
        'status': _status,
        'is_operational': _operational,
        'notes': _notes.text.trim(),
        if (_nonOperationalReason != null) 'non_operational_reason': _nonOperationalReason,
      });
      if (!mounted) return;
      setState(() => _editing = false);
      ref.invalidate(_vehicleProvider(widget.vehicleId));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.s.t('actions.save'))),
      );
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final async = ref.watch(_vehicleProvider(widget.vehicleId));
    final canEdit = ref.watch(sessionProvider).permissions.contains('asset:update');
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('vehicle.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
        actions: [
          if (canEdit && async.hasValue)
            IconButton(
              tooltip: strings.t('vehicle.edit'),
              icon: const Icon(Icons.edit_rounded),
              onPressed: () => setState(() {
                _editing = !_editing;
                _notes.text = (async.value?['notes'] ?? '').toString();
                _status = (async.value?['status'] ?? 'AVAILABLE').toString();
                _operational = async.value?['is_operational'] != false;
              }),
            ),
        ],
      ),
      body: Screen(
        refresh: () async => ref.invalidate(_vehicleProvider(widget.vehicleId)),
        child: async.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e),
          data: (v) {
            final visual = adminVehicleStatusVisual(v['status']?.toString());
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                HelixText(v['license_plate']?.toString() ?? '', style: TypeScale.title(AppColors.text)),
                const SizedBox(height: AppSpace.s2),
                AdminStatusChip(
                  label: adminVehicleStatusLabel(context, v['status']?.toString()),
                  glyph: visual.glyph,
                  color: visual.color,
                ),
                const SizedBox(height: AppSpace.s4),
                HelixCard(
                  child: Column(
                    children: [
                      KeyValueRow(label: strings.t('vehicle.make'), value: '${v['make'] ?? '—'}'),
                      KeyValueRow(label: strings.t('vehicle.model'), value: '${v['model'] ?? '—'}'),
                      KeyValueRow(label: strings.t('vehicle.class'), value: '${v['vehicle_class'] ?? '—'}'),
                      KeyValueRow(
                        label: strings.t('shift.odometer'),
                        value: Fmt.km(adminNum(v['current_odometer_km'])),
                      ),
                      KeyValueRow(
                        label: strings.t('forms.litres'),
                        value: '${adminNum(v['fuel_tank_capacity_litres']) ?? '—'} L',
                      ),
                      KeyValueRow(
                        label: strings.t('vehicle.nonOperationalReason'),
                        value: '${v['non_operational_reason'] ?? '—'}',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s4),
                if (_editing) ...[
                  HelixText(strings.t('vehicle.status'), style: TypeScale.caption(AppColors.textSecondary)),
                  const SizedBox(height: AppSpace.s2),
                  DropdownButtonFormField<String>(
                    initialValue: _status,
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: AppColors.surfaceSunk,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
                    ),
                    items: const ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'QUARANTINED', 'RETIRED', 'EXTERNAL']
                        .map(
                          (s) => DropdownMenuItem(
                            value: s,
                            child: HelixText(adminVehicleStatusLabel(context, s), style: TypeScale.body(AppColors.text)),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _status = v ?? 'AVAILABLE'),
                  ),
                  const SizedBox(height: AppSpace.s3),
                  HelixCard(
                    child: Row(
                      children: [
                        Expanded(
                          child: HelixText(strings.t('status.OPERATIONAL'), style: TypeScale.body(AppColors.text)),
                        ),
                        Switch(
                          value: _operational,
                          onChanged: (v) => setState(() => _operational = v),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.s3),
                  Field(label: strings.t('forms.notes'), controller: _notes, maxLines: 3),
                  const SizedBox(height: AppSpace.s4),
                  StrandButton(
                    label: strings.t('actions.save'),
                    shell: Shell.admin,
                    busy: _busy,
                    onPressed: _busy ? null : _save,
                  ),
                ] else ...[
                  QuietButton(
                    label: strings.t('vehicle.issues'),
                    onPressed: () => context.push('/admin/vehicle-issues/${widget.vehicleId}'),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

final _vehicleProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.watch(repositoryProvider).vehicle(id);
});
