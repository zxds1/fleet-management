import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/offline/queue.dart';
import '../../core/policy.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/hold_to_confirm.dart';
import '../../design/components/privacy_shield.dart';
import '../../design/components/screen.dart';
import '../../app/container.dart';
import '../../app/providers.dart';
import '../../design/components/skeleton.dart';
import '../../design/components/status_badge.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// Driver Home: "where do I stand". Shift state → Mayday → clock out → rest
/// banner → quick links. The single largest control is never a submit button.
class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  Timer? _ticker;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    // The duty countdown owns its own clock, so the screen does not rebuild
    // every thirty seconds just to move a colon.
    _ticker = null;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _sendMayday() async {
    final container = ref.read(containerProvider);
    final strings = context.s;
    try {
      final fix = await currentFix();
      if (fix == null) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(strings.t('mayday.noGps'))),
        );
        return;
      }
      final repo = ref.read(repositoryProvider);
      final shift = await ref.read(activeShiftProvider.future);
      final vehicleId = shift?['vehicle_id'] ?? (await repo.myAssignment())?['vehicle_id'];
      // The mayday goes through the offline queue: an emergency with no signal
      // must not be lost.
      final op = QueueOp(
        method: 'POST',
        path: 'accidents/mayday',
        body: {
          'shift_id': shift?['shift_id'],
          'vehicle_id': vehicleId,
          'position': {'latitude': fix.latitude, 'longitude': fix.longitude},
          'mayday_reason': 'MAYDAY',
        },
      );
      final result = await ref.read(offQueueProvider).submitStaged([op]);
      container.phoneTracker.flushOnStop();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(strings.t(result.allSent ? 'mayday.sent' : 'mayday.queued'))),
      );
    } on HelixError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${strings.t('mayday.failed')} · ${strings.t(e.catalogue.i18nKey)}'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(strings.t('mayday.failed'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final shiftAsync = ref.watch(activeShiftProvider);
    final onboardingAsync = ref.watch(onboardingProvider);

    return PrivacyShield(
      child: Screen(
        refresh: () async {
          ref.invalidate(activeShiftProvider);
          ref.invalidate(onboardingProvider);
          ref.invalidate(outboxCountProvider);
        },
        child: Column
          (
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpace.s2),
            HelixText(
              onboardingAsync.whenOrNull(data: (v) => v?['full_name'] as String?) ?? strings.t('nav.home'),
              style: TypeScale.display(AppColors.text),
            ),
            const SizedBox(height: AppSpace.s5),

            // ── Mayday: the one emergency control ──
            HoldToConfirm(
              label: strings.t('mayday.hold'),
              holdingLabel: strings.t('mayday.holding'),
              onConfirmed: _sendMayday,
              hold: Policy.maydayHold,
              reducedMotion: _reduceMotion,
              fillColor: AppColors.statusDanger,
            ),
            const SizedBox(height: AppSpace.s2),
            HelixText(strings.t('mayday.hint'), style: TypeScale.caption(AppColors.textSecondary)),
            const SizedBox(height: AppSpace.s5),

            // ── shift state ──
            shiftAsync.when(
              loading: () => const HelixCard(child: Skeleton(height: 72)),
              error: (e, _) => HelixCard(child: inlineError(context, e, retry: () => ref.invalidate(activeShiftProvider))),
              data: (shift) => _ShiftCard(
                shift: shift,
                onClockOut: () => context.push('/driver/clock-out'),
                onClockIn: () => context.push('/driver/clock-in'),
              ),
            ),

            // ── rest banner ──
            ref.watch(hosRestProvider).maybeWhen(
                  data: (rest) => rest == null
                      ? const SizedBox.shrink()
                      : Padding(
                          padding: const EdgeInsets.only(top: AppSpace.s4),
                          child: HelixCard(
                            child: Row(
                              children: [
                                Icon(Icons.schedule_rounded, color: AppColors.statusAmber),
                                const SizedBox(width: AppSpace.s3),
                                Expanded(
                                  child: HelixText(
                                    strings.t('shift.restUntil', {'time': Fmt.time(rest)}),
                                    style: TypeScale.body(AppColors.text),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                  orElse: () => const SizedBox.shrink(),
                ),

            const SizedBox(height: AppSpace.s5),
          ],
        ),
      ),
    );
  }
}
class _ShiftCard extends StatelessWidget {
  const _ShiftCard({required this.shift, required this.onClockIn, required this.onClockOut});

  final Map<String, dynamic>? shift;
  final VoidCallback onClockIn;
  final VoidCallback onClockOut;

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    if (shift == null) {
      return HelixCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                HelixChip(label: strings.t('shift.noShift'), color: AppColors.statusNeutral, glyph: '○'),
              ],
            ),
            const SizedBox(height: AppSpace.s3),
            HelixText(strings.t('shift.noAssignmentHint'), style: TypeScale.body(AppColors.textSecondary)),
            const SizedBox(height: AppSpace.s4),
            StrandButton(label: strings.t('shift.clockIn'), shell: Shell.driver, onPressed: onClockIn),
          ],
        ),
      );
    }
    final clockInAt = Fmt.parseTimestamp(shift!['clock_in_at']?.toString());
    return HelixCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              HelixChip(label: strings.t('shift.clockedIn'), color: AppColors.statusOk, glyph: '►'),
              const Spacer(),
              _DutyCountdown(clockedInAt: clockInAt),
            ],
          ),
          const SizedBox(height: AppSpace.s3),
          KeyValueRow(
            label: strings.t('shift.assignment'),
            value: shift!['vehicle_label']?.toString() ?? '—',
            mono: false,
          ),
          const SizedBox(height: AppSpace.s2),
          StrandButton(label: strings.t('shift.clockOut'), shell: Shell.driver, onPressed: onClockOut),
        ],
      ),
    );
  }
}

/// The elapsed duty time, ticking on its own.
///
/// It used to be a screen-wide timer that rebuilt the whole home screen every
/// thirty seconds — the Mayday control, the shift card and the assignment
/// card all rebuilt for one changing string.
class _DutyCountdown extends StatefulWidget {
  const _DutyCountdown({required this.clockedInAt});

  final DateTime? clockedInAt;

  @override
  State<_DutyCountdown> createState() => _DutyCountdownState();
}

class _DutyCountdownState extends State<_DutyCountdown> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    if (widget.clockedInAt == null) return;
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(_DutyCountdown oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clockedInAt == widget.clockedInAt) return;
    _ticker?.cancel();
    _ticker = null;
    if (widget.clockedInAt != null) {
      _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final at = widget.clockedInAt;
    final duty = at == null ? '' : Fmt.countdown(DateTime.now().toUtc().difference(at));
    return HelixText(duty, style: TypeScale.mono(AppColors.text));
  }
}
