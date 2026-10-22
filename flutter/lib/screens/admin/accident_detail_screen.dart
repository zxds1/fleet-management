import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Accident detail: escalation countdown (in place, no ticking animation),
/// acknowledge (gated), telemetry hash-chain verify, media via 302.
class AccidentDetailScreen extends ConsumerStatefulWidget {
  const AccidentDetailScreen({super.key, required this.accidentId});

  final String accidentId;

  @override
  ConsumerState<AccidentDetailScreen> createState() => _AccidentDetailScreenState();
}

class _AccidentDetailScreenState extends ConsumerState<AccidentDetailScreen> {
  Timer? _ticker;
  Map<String, dynamic>? _telemetry;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _acknowledge(BuildContext context) async {
    try {
      await ref.read(repositoryProvider).acknowledgeAccident(widget.accidentId);
      if (context.mounted) ref.invalidate(_accidentProvider(widget.accidentId));
    } on HelixError catch (e) {
      if (context.mounted) showHelixError(context, e);
    }
  }

  Future<void> _verifyTelemetry() async {
    final strings = context.s;
    try {
      final result = await ref.read(repositoryProvider).verifyTelemetry(widget.accidentId);
      if (!mounted) return;
      setState(() => _telemetry = result);
      final ok = result['all_valid'] == true;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ok ? strings.t('admin.telemetryOk') : strings.t('admin.telemetryBad'))),
      );
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final async = ref.watch(_accidentProvider(widget.accidentId));
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('admin.accidents'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: Screen(
        refresh: () async => ref.invalidate(_accidentProvider(widget.accidentId)),
        child: async.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e),
          data: (row) {
            final seconds = row['seconds_to_escalation'] as int?;
            final countdown = seconds == null ? '—' : Fmt.countdown(Duration(seconds: seconds));
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (row['mayday'] == true)
                      HelixChip(label: strings.t('admin.mayday'), color: AppColors.statusDanger, glyph: '▲'),
                    const Spacer(),
                    HelixText(countdown, style: TypeScale.mono(AppColors.statusDanger, size: 22)),
                  ],
                ),
                const SizedBox(height: AppSpace.s2),
                HelixText(row['reference']?.toString() ?? '', style: TypeScale.title(AppColors.text)),
                const SizedBox(height: AppSpace.s3),
                HelixCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      HelixText(row['driver_statement']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
                      Divider(height: 24, color: AppColors.line),
                      KeyValueRow(label: strings.t('detail.position'), value: row['location_label']?.toString() ?? '—', mono: false),
                      KeyValueRow(label: strings.t('detail.tier'), value: strings.t('detail.tierShort', {'n': '${row['escalation_tier'] ?? 0}'}), mono: false),
                      KeyValueRow(
                        label: strings.t('detail.acked'),
                        value: row['acknowledged_at'] == null ? strings.t('detail.notAcked') : strings.t('detail.acked'),
                        mono: false,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s4),
                QuietButton(
                  label: strings.t('admin.telemetry'),
                  icon: Icon(Icons.link_rounded, size: 20, color: AppColors.textSecondary),
                  onPressed: _verifyTelemetry,
                ),
                if (_telemetry != null) ...[
                  const SizedBox(height: AppSpace.s2),
                  HelixText(
                    _telemetry!['all_valid'] == true ? strings.t('admin.telemetryOk') : strings.t('admin.telemetryBad'),
                    style: TypeScale.caption(
                      _telemetry!['all_valid'] == true ? AppColors.statusOk : AppColors.statusDanger,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpace.s4),
                if (row['acknowledged_at'] == null)
                  StrandButton(
                    label: strings.t('admin.acknowledge'),
                    shell: Shell.admin,
                    onPressed: () => _acknowledge(context),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

final _accidentProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.watch(repositoryProvider).accident(id);
});
