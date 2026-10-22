import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/container.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/media.dart';
import '../../core/offline/queue.dart';
import '../../core/policy.dart';
import '../../design/components/buttons.dart';
import '../../design/components/field.dart';
import '../../design/components/form_shell.dart';
import '../../design/components/gauge_picker.dart';
import '../../design/components/photo_capture.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// Clock out: flush buffered positions first so the flag is honest, then
/// odometer + gauge + photo + debrief.
class ClockOutScreen extends ConsumerStatefulWidget {
  const ClockOutScreen({super.key});

  @override
  ConsumerState<ClockOutScreen> createState() => _ClockOutScreenState();
}

class _ClockOutScreenState extends ConsumerState<ClockOutScreen> {
  final _odometer = TextEditingController();
  final _debrief = TextEditingController();
  final _formKey = GlobalKey<FormShellState>();
  GaugePosition? _gauge;
  XFile? _photo;
  bool _busy = false;
  String? _odometerServerError;

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final strings = context.s;
    try {
      final shift = await ref.read(activeShiftProvider.future);
      final km = int.tryParse(_odometer.text.trim());
      final lastKm = await ref.read(lastOdometerProvider.future);
      final odometerError = _odometerError(km, lastKm);
      if (shift == null || km == null || _gauge == null || _photo == null || odometerError != null) {
        setState(() => _odometerServerError = odometerError);
        return;
      }

      await ref.read(containerProvider).phoneTracker.flushOnStop();
      final staged = await ref.read(mediaProvider).stageCapture(
            await _photo!.readAsBytes(),
            slot: MediaService.slotClockOut,
            ownerKind: MediaService.ownerWorkLog,
            retentionClass: MediaService.retentionWorkPlan,
          );
      if (staged == null) {
        throw HelixError(code: 'UPLOAD_UNAVAILABLE', status: 0);
      }
      final op = QueueOp(
        method: 'POST',
        path: 'shifts/clock-out',
        body: {
          'shift_id': shift['shift_id'],
          'end_odometer_km': km,
          'end_fuel_gauge': gaugeApiValue(_gauge!),
          'end_media_object_id': staged.slot,
          if (_debrief.text.trim().isNotEmpty) 'debrief_notes': _debrief.text.trim(),
        },
        uploads: [staged],
      );
      final result = await ref.read(offQueueProvider).submitStaged([op]);
      if (!mounted) return;
      if (result.allSent) {
        _formKey.currentState?.showSent();
      } else {
        _formKey.currentState?.showQueued();
      }
    } on HelixError catch (e) {
      if (!mounted) return;
      setState(() => _odometerServerError = fieldErrorFor(e, 'end_odometer_km'));
      _formKey.currentState?.showError(strings.error(e.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The end reading must be at least the start reading and within the policy
  /// jump of it.
  String? _odometerError(int? km, int? lastKm) {
    if (km == null) return null;
    if (km <= 0) {
      return context.s.t('forms.odometerLower', {'last': '${lastKm ?? 0}'});
    }
    if (lastKm == null) return null;
    if (km < lastKm) {
      return context.s.t('forms.odometerLower', {'last': '$lastKm'});
    }
    if (km - lastKm > Policy.odometerMaxJumpKm) {
      return context.s.t('forms.odometerJump', {'km': '${km - lastKm}'});
    }
    return null;
  }

  List<String> _missing() {
    final strings = context.s;
    final missing = <String>[];
    if (int.tryParse(_odometer.text.trim()) == null) missing.add(strings.t('shift.odometer'));
    if (_gauge == null) missing.add(strings.t('gauge.label'));
    if (_photo == null) missing.add(strings.t('shift.photo'));
    return missing;
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final lastKm = ref.watch(lastOdometerProvider).valueOrNull;
    final missing = _missing();
    final odometerError = _odometerError(int.tryParse(_odometer.text.trim()), lastKm);
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('shift.clockOut'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        child: FormShell(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Field(
                label: strings.t('shift.odometer'),
                controller: _odometer,
                keyboardType: TextInputType.number,
                helperText: strings.t('forms.lastReading', {'km': lastKm == null ? '—' : '$lastKm'}),
                errorText: odometerError ?? _odometerServerError,
                onChanged: (_) => setState(() => _odometerServerError = null),
              ),
              const SizedBox(height: AppSpace.s4),
              HelixText(strings.t('gauge.label'), style: TypeScale.caption(AppColors.textSecondary)),
              const SizedBox(height: AppSpace.s2),
              GaugePicker(value: _gauge, onChanged: (v) => setState(() => _gauge = v)),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(
                cameras: ref.watch(camerasProvider).valueOrNull ?? const [],
                label: strings.t('shift.photo'),
                captured: _photo,
                onCaptured: (file) => setState(() => _photo = file),
              ),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('shift.notes'), controller: _debrief, maxLines: 3),
              if (missing.isNotEmpty) ...[
                const SizedBox(height: AppSpace.s3),
                HelixText(
                  strings.t('forms.missing', {'items': missing.join(', ')}),
                  style: TypeScale.caption(AppColors.statusWarn),
                ),
              ],
              const SizedBox(height: AppSpace.s5),
              StrandButton(
                label: strings.t('actions.submit'),
                shell: Shell.driver,
                onPressed: (missing.isNotEmpty || odometerError != null || _busy) ? null : _submit,
                busy: _busy,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
