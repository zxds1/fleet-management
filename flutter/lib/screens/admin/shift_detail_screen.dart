import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../app/providers.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// Shift detail: verify / flag-with-reason / force-close — all gated.
///
/// The review endpoint is `POST /shifts/:id/verify`, whose body is
/// `{action, flag_reason, corrected_end_odometer_km}`. A VERIFY never carries
/// a reason; a FLAG always carries one. Force-close is a different endpoint
/// with its own `reason` field.
class ShiftDetailScreen extends ConsumerStatefulWidget {
  const ShiftDetailScreen({super.key, required this.shiftId});

  final String shiftId;

  @override
  ConsumerState<ShiftDetailScreen> createState() => _ShiftDetailScreenState();
}

class _ShiftDetailScreenState extends ConsumerState<ShiftDetailScreen> {
  final _correctedOdometer = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _correctedOdometer.dispose();
    super.dispose();
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      ref.invalidate(_shiftProvider(widget.shiftId));
      bumpAdminRevision(ref, 'shifts');
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (!adminCan(ref, 'shift:verify')) return;
    await _act(() => ref.read(repositoryProvider).verifyShift(widget.shiftId, {'action': 'VERIFY'}));
  }

  Future<void> _flag() async {
    if (!adminCan(ref, 'shift:verify')) return;
    final strings = context.s;
    final reason = await SheetHost.show<String>(
      context: context,
      title: strings.t('shifts.flagReason'),
      child: AdminReasonForm(
        label: strings.t('shifts.flagReason'),
        submitLabel: strings.t('admin.flag'),
      ),
    );
    if (reason == null || reason.trim().isEmpty) return;
    final corrected = double.tryParse(_correctedOdometer.text.trim());
    await _act(
      () => ref.read(repositoryProvider).verifyShift(widget.shiftId, {
        'action': 'FLAG',
        'flag_reason': reason.trim(),
        'corrected_end_odometer_km': corrected,
      }),
    );
  }

  Future<void> _forceClose() async {
    if (!adminCan(ref, 'shift:force_close')) return;
    final strings = context.s;
    final reason = await SheetHost.show<String>(
      context: context,
      title: strings.t('shifts.forceClose'),
      child: AdminReasonForm(
        label: strings.t('shifts.flagReason'),
        submitLabel: strings.t('shifts.forceClose'),
      ),
    );
    if (reason == null || reason.trim().isEmpty) return;
    await _act(
      () => ref.read(repositoryProvider).forceCloseShift(widget.shiftId, reason: reason.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final canVerify = ref.watch(sessionProvider).permissions.contains('shift:verify');
    final canForceClose = ref.watch(sessionProvider).permissions.contains('shift:force_close');
    final async = ref.watch(_shiftProvider(widget.shiftId));
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('shifts.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: Screen(
        refresh: () async => ref.invalidate(_shiftProvider(widget.shiftId)),
        child: async.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e),
          data: (row) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  HelixChip(
                    label: strings.t('shifts.${row['verification_status'] ?? 'PENDING'}'),
                    color: AppColors.statusWarn,
                  ),
                  const SizedBox(width: AppSpace.s2),
                  HelixChip(label: strings.t('shifts.${row['state'] ?? 'OPEN'}'), color: AppColors.statusNeutral),
                ],
              ),
              const SizedBox(height: AppSpace.s4),
              HelixCard(
                child: Column(
                  children: [
                    KeyValueRow(
                      label: strings.t('shifts.clockIn'),
                      value: Fmt.dateTime(Fmt.parseTimestamp(row['clock_in_at']?.toString())),
                    ),
                    KeyValueRow(
                      label: strings.t('shifts.clockOut'),
                      value: Fmt.dateTime(Fmt.parseTimestamp(row['clock_out_at']?.toString())),
                    ),
                    KeyValueRow(label: strings.t('shifts.distance'), value: '${row['total_distance_km'] ?? '—'}'),
                    KeyValueRow(
                      label: strings.t('shifts.duration'),
                      value: Fmt.countdown(
                        Duration(seconds: _durationSeconds(row)),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpace.s4),
              HelixCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HelixText(strings.t('shifts.workPlan'), style: TypeScale.caption(AppColors.textSecondary)),
                    const SizedBox(height: AppSpace.s2),
                    HelixText(row['planned_notes']?.toString() ?? strings.t('shifts.noPlan'), style: TypeScale.body(AppColors.text)),
                  ],
                ),
              ),
              if (canVerify) ...[
                const SizedBox(height: AppSpace.s4),
                Field(
                  label: strings.t('shift.odometer'),
                  controller: _correctedOdometer,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                ),
                const SizedBox(height: AppSpace.s4),
                StrandButton(
                  label: strings.t('admin.verify'),
                  shell: Shell.admin,
                  busy: _busy,
                  onPressed: _busy ? null : _verify,
                ),
                const SizedBox(height: AppSpace.s2),
                QuietButton(
                  label: strings.t('admin.flag'),
                  busy: _busy,
                  onPressed: _busy ? null : _flag,
                ),
              ],
              if (canForceClose) ...[
                const SizedBox(height: AppSpace.s2),
                QuietButton(
                  label: strings.t('shifts.forceClose'),
                  busy: _busy,
                  onPressed: _busy ? null : _forceClose,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static int _durationSeconds(Map<String, dynamic> row) {
    final start = Fmt.parseTimestamp(row['clock_in_at']?.toString());
    final end = Fmt.parseTimestamp(row['clock_out_at']?.toString());
    if (start == null || end == null) return 0;
    return end.difference(start).inSeconds;
  }
}

final _shiftProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.watch(repositoryProvider).shift(id);
});
