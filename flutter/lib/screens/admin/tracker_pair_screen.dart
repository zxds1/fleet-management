import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// Tracker pairing: IMEI (exactly 15 digits) + vehicle picker + brand,
/// submitted camelCase to the hardware router. The UI sends the IMEI by hand
/// in the shipped path (QR scanning drops out without a barcode dependency).
class TrackerPairScreen extends ConsumerStatefulWidget {
  const TrackerPairScreen({super.key});

  @override
  ConsumerState<TrackerPairScreen> createState() => _TrackerPairScreenState();
}

/// The hardware router accepts exactly fifteen digits.
final _imeiPattern = RegExp(r'^\d{15}$');

class _TrackerPairScreenState extends ConsumerState<TrackerPairScreen> {
  final _imei = TextEditingController();
  final _sim = TextEditingController();
  String? _vehicleId;
  String _brand = 'GENERIC_H02';
  bool _busy = false;
  String? _imeiError;
  String? _vehicleError;

  @override
  void dispose() {
    _imei.dispose();
    _sim.dispose();
    super.dispose();
  }

  bool get _imeiValid => _imeiPattern.hasMatch(_imei.text.trim());

  Future<void> _pair() async {
    final strings = context.s;
    setState(() {
      _busy = true;
      _imeiError = _imeiValid ? null : strings.error('INVALID_IMEI');
      _vehicleError = _vehicleId == null ? strings.error('VEHICLE_REQUIRED') : null;
    });
    if (!_imeiValid || _vehicleId == null) return;
    try {
      await ref.read(repositoryProvider).pairTracker({
        'vehicleId': _vehicleId,
        'trackerImei': _imei.text.trim(),
        'trackerBrand': _brand,
        if (_sim.text.trim().isNotEmpty) 'trackerSimNumber': _sim.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(strings.t('hardware.paired'))));
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final vehiclesAsync = ref.watch(adminVehiclesProvider);
    final ready = _imeiValid && _vehicleId != null && !_busy;
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('hardware.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: Screen(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HelixText(strings.t('hardware.enterManually'), style: TypeScale.body(AppColors.text)),
            const SizedBox(height: AppSpace.s5),
            Field(
              label: strings.t('hardware.imei'),
              controller: _imei,
              keyboardType: TextInputType.number,
              required: true,
              errorText: _imeiError,
              onChanged: (value) => setState(() {
                _imeiError = null;
              }),
            ),
            const SizedBox(height: AppSpace.s4),
            HelixText(strings.t('hardware.vehicle'), style: TypeScale.caption(AppColors.textSecondary)),
            const SizedBox(height: AppSpace.s2),
            vehiclesAsync.when(
              loading: () => const LoadingBody(),
              error: (e, _) => inlineError(context, e, retry: () => ref.invalidate(adminVehiclesProvider)),
              data: (vehicles) {
                if (vehicles.isEmpty) {
                  return HelixText(
                    strings.t('vehicle.none'),
                    style: TypeScale.caption(AppColors.textSecondary),
                  );
                }
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
                      ),
                      items: items,
                      onChanged: (v) => setState(() {
                        _vehicleId = v;
                        _vehicleError = null;
                      }),
                    ),
                    if (_vehicleError != null) ...[
                      const SizedBox(height: AppSpace.s1),
                      HelixText(_vehicleError!, style: TypeScale.caption(AppColors.statusDanger)),
                    ],
                  ],
                );
              },
            ),
            const SizedBox(height: AppSpace.s4),
            HelixText(strings.t('hardware.brand'), style: TypeScale.caption(AppColors.textSecondary)),
            DropdownButtonFormField<String>(
              initialValue: _brand,
              decoration: InputDecoration(
                filled: true,
                fillColor: AppColors.surfaceSunk,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.control)),
              ),
              items: const [
                'GENERIC_H02',
                'TELTONIKA',
                'QUECLINK',
                'JIMI',
                'TK_STAR',
                'CALE',
                'SINTRONES',
              ]
                  .map((b) => DropdownMenuItem(value: b, child: HelixText(b, style: TypeScale.body(AppColors.text))))
                  .toList(),
              onChanged: (v) => setState(() => _brand = v ?? 'GENERIC_H02'),
            ),
            const SizedBox(height: AppSpace.s4),
            Field(label: strings.t('hardware.sim'), controller: _sim),
            const SizedBox(height: AppSpace.s5),
            StrandButton(
              label: strings.t('hardware.pair'),
              shell: Shell.admin,
              onPressed: ready ? _pair : null,
              busy: _busy,
            ),
            if (!ready && !_busy) ...[
              const SizedBox(height: AppSpace.s2),
              HelixText(
                _imeiValid ? strings.error('VEHICLE_REQUIRED') : strings.error('INVALID_IMEI'),
                style: TypeScale.caption(AppColors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
