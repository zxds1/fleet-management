import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/container.dart';
import '../../app/providers.dart';
import '../../core/config.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/media.dart';
import '../../core/offline/queue.dart';
import '../../core/policy.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/form_shell.dart';
import '../../design/components/gauge_picker.dart';
import '../../design/components/photo_capture.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/components/skeleton.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// Clock in: assignment (server-decided) → odometer (guarded) → gauge
/// (required) → photo → optional plan → honest location toggle → submit.
class ClockInScreen extends ConsumerStatefulWidget {
  const ClockInScreen({super.key});

  @override
  ConsumerState<ClockInScreen> createState() => _ClockInScreenState();
}

class _ClockInScreenState extends ConsumerState<ClockInScreen> {
  final _odometer = TextEditingController();
  final _notes = TextEditingController();
  final _formKey = GlobalKey<FormShellState>();
  GaugePosition? _gauge;
  XFile? _photo;
  bool _shareLocation = false;
  bool _busy = false;
  String? _disclaimer;
  String? _odometerServerError;

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final strings = context.s;
    try {
      final repo = ref.read(repositoryProvider);
      final container = ref.read(containerProvider);
      final assignment = await repo.myAssignment();
      if (assignment == null) {
        throw HelixError(code: 'NO_ASSIGNMENT', status: 404);
      }
      // The assignment row names the assignment itself `assignment_id`.
      final assignmentId = assignment['assignment_id']?.toString() ?? assignment['id']?.toString();
      if (assignmentId == null || assignmentId.isEmpty) {
        throw HelixError(code: 'NO_ASSIGNMENT', status: 404);
      }
      final shiftVehicle = assignment['vehicle_id'] as String?;
      final km = int.tryParse(_odometer.text.trim());
      final lastKm = await ref.read(lastOdometerProvider.future);
      final odometerError = _odometerError(km, lastKm);
      if (km == null || _gauge == null || _photo == null || shiftVehicle == null || odometerError != null) {
        setState(() => _odometerServerError = odometerError);
        return;
      }
      if (await _dutyBlocked()) {
        throw HelixError(code: 'HOS_REST_BLOCKED', status: 422);
      }

      if (_shareLocation) {
        await container.phoneTracker.start(); // start BEFORE the write so the flag is honest
      }
      final staged = await ref.read(mediaProvider).stageCapture(
            await _photo!.readAsBytes(),
            slot: MediaService.slotClockIn,
            ownerKind: MediaService.ownerWorkLog,
            retentionClass: MediaService.retentionWorkPlan,
          );
      if (staged == null) {
        throw HelixError(code: 'UPLOAD_UNAVAILABLE', status: 0);
      }
      final op = QueueOp(
        method: 'POST',
        path: 'shifts/clock-in',
        body: {
          'assignment_id': assignmentId,
          'start_odometer_km': km,
          'start_fuel_gauge': gaugeApiValue(_gauge!),
          'start_media_object_id': staged.slot,
          'phone_gps_fallback_enabled': _shareLocation,
          'consent_version': Config.consentVersion,
          if (_notes.text.trim().isNotEmpty) 'planned_notes': _notes.text.trim(),
        },
        uploads: [staged],
        produces: 'shift_id',
      );
      final result = await ref.read(offQueueProvider).submitStaged([op]);
      if (!mounted) return;
      if (result.allSent) {
        // the server returns its disclaimer beside a successful clock-in
        setState(() {
          _disclaimer = result.firstResponse?['disclaimer'] as String?;
        });
        _formKey.currentState?.showSent();
      } else {
        _formKey.currentState?.showQueued();
      }
    } on HelixError catch (e) {
      if (!mounted) return;
      setState(() => _odometerServerError = fieldErrorFor(e, 'start_odometer_km'));
      _formKey.currentState?.showError(strings.error(e.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The driver may not clock in inside a mandatory rest period, nor past the
  /// duty limit.
  Future<bool> _dutyBlocked() async {
    final now = DateTime.now().toUtc();
    final hosRest = await ref.read(hosRestProvider.future);
    if (hosRest != null && hosRest.isAfter(now)) return true;
    final shift = await ref.read(activeShiftProvider.future);
    final clockedInAt = Fmt.parseTimestamp(shift?['clock_in_at']?.toString());
    if (clockedInAt != null &&
        clockedInAt.isBefore(now.subtract(const Duration(hours: Policy.maxDutyHours)))) {
      return true;
    }
    return false;
  }

  /// The odometer must move forward, and never by more than the policy jump.
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

  List<String> _missing(int? lastKm) {
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
    final hosRest = ref.watch(hosRestProvider).valueOrNull;
    final missing = _missing(lastKm);
    final odometerError = _odometerError(int.tryParse(_odometer.text.trim()), lastKm);
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('shift.clockIn'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        child: FormShell(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ref.watch(assignmentProvider).when(
                loading: () => Skeleton(height: 56),
                error: (e, _) => inlineError(context, e),
                data: (assignment) => HelixCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      HelixText(strings.t('shift.assignment'), style: TypeScale.caption(AppColors.textSecondary)),
                      const SizedBox(height: AppSpace.s1),
                      HelixText(
                        assignment?['vehicle_label']?.toString() ??
                            assignment?['plate']?.toString() ??
                            '—',
                        style: TypeScale.lead(AppColors.text),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppSpace.s4),
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
              GaugePicker(
                value: _gauge,
                onChanged: (v) => setState(() => _gauge = v),
              ),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(
                cameras: ref.watch(camerasProvider).valueOrNull ?? const [],
                label: strings.t('shift.photo'),
                captured: _photo,
                onCaptured: (file) => setState(() => _photo = file),
              ),
              const SizedBox(height: AppSpace.s4),
              Field(
                label: strings.t('shift.workPlan'),
                controller: _notes,
                maxLines: 3,
              ),
              const SizedBox(height: AppSpace.s4),
              SwitchListTile(
                value: _shareLocation,
                activeThumbColor: AppColors.accentText,
                title: HelixText(strings.t('shift.phoneFallback'), style: TypeScale.body(AppColors.text)),
                subtitle: HelixText(strings.t('shift.phoneFallbackHelp'), style: TypeScale.caption(AppColors.textSecondary)),
                contentPadding: EdgeInsets.zero,
                onChanged: (v) => setState(() => _shareLocation = v),
              ),
              if (missing.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.s3),
                  child: HelixText(
                    strings.t('forms.missing', {'items': missing.join(', ')}),
                    style: TypeScale.caption(AppColors.statusWarn),
                  ),
                ),
              if (hosRest != null && hosRest.isAfter(DateTime.now().toUtc()))
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.s3),
                  child: HelixText(
                    strings.t('shift.restUntil', {'time': Fmt.time(hosRest)}),
                    style: TypeScale.caption(AppColors.statusWarn),
                  ),
                ),
              if (_disclaimer != null) ...[
                const SizedBox(height: AppSpace.s4),
                HelixCard(
                  child: HelixText(_disclaimer!, style: TypeScale.body(AppColors.text)),
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
