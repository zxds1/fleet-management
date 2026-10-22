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
import '../../design/components/sheet_host.dart';
import '../../design/components/states.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';
import 'vehicle_detail_screen.dart';

/// Fleet vehicles: live status, odometer, issues. Tapping a row opens the
/// vehicle, which is where it is edited.
class VehiclesScreen extends ConsumerWidget {
  const VehiclesScreen({super.key});

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    if (!adminCan(ref, 'asset:create')) return;
    final strings = context.s;
    await SheetHost.show<void>(
      context: context,
      title: strings.t('vehicle.create'),
      child: const _VehicleCreateForm(),
    );
    ref.invalidate(adminVehiclesProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final async = ref.watch(adminVehiclesProvider);
    final canCreate = ref.watch(sessionProvider).permissions.contains('asset:create');
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('vehicle.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: async.when(
        loading: () => const LoadingBody(),
        error: (e, _) => inlineError(context, e, retry: () => ref.invalidate(adminVehiclesProvider)),
        data: (vehicles) {
          if (vehicles.isEmpty) {
            return EmptyState(message: strings.t('vehicle.none'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(AppSpace.s4),
            itemCount: vehicles.length,
            separatorBuilder: (_, _) => const SizedBox(height: AppSpace.s2),
            itemBuilder: (context, index) {
              final v = vehicles[index];
              final id = v['id']?.toString() ?? '';
              final status = v['status']?.toString();
              final visual = adminVehicleStatusVisual(status);
              return HelixCard(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => VehicleDetailScreen(vehicleId: id)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: HelixText(
                            v['license_plate']?.toString() ?? '',
                            style: TypeScale.bodyStrong(AppColors.text),
                          ),
                        ),
                        AdminStatusChip(
                          label: adminVehicleStatusLabel(context, status),
                          glyph: visual.glyph,
                          color: visual.color,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.s2),
                    HelixText(
                      '${v['make'] ?? ''} ${v['model'] ?? ''}'.trim(),
                      style: TypeScale.caption(AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpace.s1),
                    HelixText(
                      Fmt.km(adminNum(v['current_odometer_km'])),
                      style: TypeScale.caption(AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpace.s2),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: QuietButton(
                        label: strings.t('vehicle.issues'),
                        onPressed: () => context.push('/admin/vehicle-issues/$id'),
                      ),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: canCreate
          ? FloatingActionButton(
              backgroundColor: AppColors.adminAccent,
              foregroundColor: AppColors.onAdminAccent,
              onPressed: () => _create(context, ref),
              child: const Icon(Icons.add_rounded),
            )
          : null,
    );
  }
}

/// The create-vehicle form. It owns the write and pops the SHEET, so the
/// screen behind it is never popped by mistake and the controllers live for
/// exactly as long as the sheet does.
class _VehicleCreateForm extends ConsumerStatefulWidget {
  const _VehicleCreateForm();

  @override
  ConsumerState<_VehicleCreateForm> createState() => _VehicleCreateFormState();
}

class _VehicleCreateFormState extends ConsumerState<_VehicleCreateForm> {
  final _plate = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();
  String _vehicleClass = 'TRUCK';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _plate.dispose();
    _make.dispose();
    _model.dispose();
    _year.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final strings = context.s;
    if (_plate.text.trim().isEmpty) {
      setState(() => _error = strings.error('VALIDATION_ERROR'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(repositoryProvider).createVehicle({
        'license_plate': _plate.text.trim(),
        'make': _make.text.trim(),
        'model': _model.text.trim(),
        'year': int.tryParse(_year.text.trim()),
        'vehicle_class': _vehicleClass,
      });
      if (!mounted) return;
      Navigator.of(context, rootNavigator: true).pop();
    } on HelixError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.fieldErrors['license_plate'] ?? strings.error(e.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Field(label: strings.t('vehicle.plate'), controller: _plate, required: true, errorText: _error),
          const SizedBox(height: AppSpace.s3),
          Field(label: strings.t('vehicle.make'), controller: _make),
          const SizedBox(height: AppSpace.s3),
          Field(label: strings.t('vehicle.model'), controller: _model),
          const SizedBox(height: AppSpace.s3),
          Field(label: strings.t('vehicle.year'), controller: _year, keyboardType: TextInputType.number),
          const SizedBox(height: AppSpace.s3),
          HelixText(strings.t('vehicle.class'), style: TypeScale.caption(AppColors.textSecondary)),
          const SizedBox(height: AppSpace.s2),
          DropdownButtonFormField<String>(
            initialValue: _vehicleClass,
            decoration: InputDecoration(
              filled: true,
              fillColor: AppColors.surfaceSunk,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
            ),
            items: const ['TRUCK', 'VAN', 'TRACTOR', 'TRAILER', 'BUS', 'CAR']
                .map((c) => DropdownMenuItem(value: c, child: HelixText(c, style: TypeScale.body(AppColors.text))))
                .toList(),
            onChanged: (v) => setState(() => _vehicleClass = v ?? 'TRUCK'),
          ),
          const SizedBox(height: AppSpace.s4),
          StrandButton(
            label: strings.t('vehicle.create'),
            shell: Shell.admin,
            busy: _busy,
            onPressed: _busy ? null : _submit,
          ),
        ],
      ),
    );
  }
}
