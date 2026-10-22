import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/location.dart';
import '../../core/media.dart';
import '../../core/offline/queue.dart';
import '../../core/policy.dart';
import '../../design/components/buttons.dart';
import '../../design/components/field.dart';
import '../../design/components/form_shell.dart';
import '../../design/components/hold_to_confirm.dart';
import '../../design/components/photo_capture.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// Accidents: the Mayday control first (2s hold), then the triaged report.
class AccidentScreen extends ConsumerStatefulWidget {
  const AccidentScreen({super.key});

  @override
  ConsumerState<AccidentScreen> createState() => _AccidentScreenState();
}

class _AccidentScreenState extends ConsumerState<AccidentScreen> {
  final _formKey = GlobalKey<FormShellState>();
  final _statement = TextEditingController();
  final _witness = TextEditingController();
  final _plate = TextEditingController();
  XFile? _front, _rear, _side, _extra;
  bool _busy = false;
  String _severity = 'MODERATE';

  Future<void> _sendMayday() async {
    final strings = context.s;
    try {
      final fix = await currentFix();
      if (fix == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(strings.t('mayday.noGps'))));
        return;
      }
      final shift = await ref.read(activeShiftProvider.future);
      // The mayday goes through the offline queue: with no signal it must wait
      // in the outbox, not disappear.
      final op = QueueOp(
        method: 'POST',
        path: 'accidents/mayday',
        body: {
          'shift_id': shift?['shift_id'],
          'vehicle_id': shift?['vehicle_id'],
          'position': {'latitude': fix.latitude, 'longitude': fix.longitude},
          'mayday_reason': 'MAYDAY',
        },
      );
      final result = await ref.read(offQueueProvider).submitStaged([op]);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(strings.t(result.allSent ? 'mayday.sent' : 'mayday.queued'))),
      );
    } on HelixError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${strings.t('mayday.failed')} · ${strings.t(e.catalogue.i18nKey)}')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(strings.t('mayday.failed'))));
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final strings = context.s;
    try {
      final shift = await ref.read(activeShiftProvider.future);
      if (_statement.text.trim().isEmpty) return;
      final media = ref.read(mediaProvider);
      final ops = <QueueOp>[
        QueueOp(
          method: 'POST',
          path: 'accidents',
          // AccidentCreateSchema has no severity member — the server decides
          // the severity, so the selection is not part of the payload.
          body: {
            'shift_id': shift?['shift_id'],
            'vehicle_id': shift?['vehicle_id'],
            'driver_statement': _statement.text.trim(),
            if (_witness.text.trim().isNotEmpty) 'witness_name': _witness.text.trim(),
            if (_plate.text.trim().isNotEmpty) 'third_party_plate': _plate.text.trim(),
          },
          produces: 'accident_id',
        ),
      ];
      final captures = [
        (MediaService.slotAccidentFront, _front, 'FRONT_DAMAGE'),
        (MediaService.slotAccidentRear, _rear, 'REAR_DAMAGE'),
        (MediaService.slotAccidentSide, _side, 'SIDE_DAMAGE'),
        (MediaService.slotAccidentExtra, _extra, 'ADDITIONAL'),
      ];
      for (final (slotName, file, mediaSlot) in captures) {
        if (file == null) continue;
        final staged = await media.stageCapture(
          await file.readAsBytes(),
          slot: slotName,
          ownerKind: MediaService.ownerAccident,
          retentionClass: MediaService.retentionAccident,
        );
        if (staged == null) continue;
        ops.add(QueueOp(
          method: 'POST',
          path: 'accidents/{accident_id}/media',
          body: {'slot': mediaSlot, 'media_object_id': staged.slot},
          uploads: [staged],
          needs: const ['accident_id'],
        ));
      }
      final result = await ref.read(offQueueProvider).submitStaged(ops);
      if (!mounted) return;
      if (result.allSent) {
        _formKey.currentState?.showSent();
      } else {
        _formKey.currentState?.showQueued();
      }
    } on HelixError catch (e) {
      if (!mounted) return;
      _formKey.currentState?.showError(strings.t(e.catalogue.i18nKey));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final cameras = ref.watch(camerasProvider).valueOrNull ?? const [];
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('nav.accidents'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        child: FormShell(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HoldToConfirm(
                label: strings.t('accident.sendMayday'),
                holdingLabel: strings.t('mayday.holding'),
                onConfirmed: _sendMayday,
                hold: Policy.maydayHold,
                reducedMotion: reduceMotion,
                fillColor: AppColors.statusDanger,
              ),
              const SizedBox(height: AppSpace.s2),
              HelixText(strings.t('accident.maydayHelp'), style: TypeScale.caption(AppColors.textSecondary)),
              Divider(height: 40, color: AppColors.line),
              HelixText(strings.t('accident.severity'), style: TypeScale.caption(AppColors.textSecondary)),
              const SizedBox(height: AppSpace.s2),
              Wrap(
                spacing: AppSpace.s2,
                children: [
                  for (final severity in ['MINOR', 'MODERATE', 'SEVERE'])
                    _SelectableChip(
                      label: strings.t('accident.$severity'),
                      selected: _severity == severity,
                      onSelected: () => setState(() => _severity = severity),
                    ),
                ],
              ),
              const SizedBox(height: AppSpace.s3),
              HelixText(strings.t('accident.severityHint'), style: TypeScale.caption(AppColors.textTertiary)),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('accident.statement'), controller: _statement, maxLines: 4),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('accident.witness'), controller: _witness),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('accident.plate'), controller: _plate),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(cameras: cameras, label: context.s.t('accident.slot.FRONT_DAMAGE'), captured: _front, onCaptured: (f) => setState(() => _front = f)),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(cameras: cameras, label: context.s.t('accident.slot.REAR_DAMAGE'), captured: _rear, onCaptured: (f) => setState(() => _rear = f)),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(cameras: cameras, label: context.s.t('accident.slot.SIDE_DAMAGE'), captured: _side, onCaptured: (f) => setState(() => _side = f)),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(cameras: cameras, label: strings.t('accident.addPhoto'), captured: _extra, onCaptured: (f) => setState(() => _extra = f)),
              const SizedBox(height: AppSpace.s5),
              StrandButton(
                label: strings.t('accident.report'),
                shell: Shell.driver,
                onPressed: _busy || _statement.text.trim().isEmpty ? null : _submit,
                busy: _busy,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A chip the driver can actually pick. HelixChip is a caption, not a control.
class _SelectableChip extends StatelessWidget {
  const _SelectableChip({required this.label, required this.selected, required this.onSelected});

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: onSelected,
        borderRadius: BorderRadius.circular(AppRadius.full),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s3, vertical: AppSpace.s2),
          constraints: const BoxConstraints(minHeight: AppTarget.badge),
          decoration: BoxDecoration(
            color: selected ? AppColors.accentQuiet : AppColors.surfaceSunk,
            borderRadius: BorderRadius.circular(AppRadius.full),
            border: Border.all(
              color: selected ? AppColors.accentText : AppColors.line,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                selected ? Icons.check_rounded : Icons.circle_rounded,
                size: 16,
                color: selected ? AppColors.accentText : AppColors.textSecondary,
              ),
              const SizedBox(width: AppSpace.s2),
              HelixText(
                label,
                style: TypeScale.caption(selected ? AppColors.accentText : AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
