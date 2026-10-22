import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// Fuel purchase detail: KES amounts in mono, OCR confidence, gauge
/// before/after/delta, and the three gated actions — verify (optional
/// adjusted litres), reject (reason), clear payment.
///
/// The row comes from `app.v_fuel_reconciliation_inbox`: litres, total_cost,
/// ocr_confidence and the two gauge percentages.
class FuelDetailScreen extends ConsumerStatefulWidget {
  const FuelDetailScreen({super.key, required this.purchaseId});

  final String purchaseId;

  @override
  ConsumerState<FuelDetailScreen> createState() => _FuelDetailScreenState();
}

class _FuelDetailScreenState extends ConsumerState<FuelDetailScreen> {
  final _adjusted = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _adjusted.dispose();
    super.dispose();
  }

  Future<void> _verify({String? rejectReason, bool clearPayment = false}) async {
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        'action': rejectReason != null
            ? 'REJECT'
            : clearPayment
                ? 'CLEAR_PAYMENT'
                : 'VERIFY',
        'rejection_reason': ?rejectReason,
        if (_adjusted.text.trim().isNotEmpty) 'adjusted_litres': double.tryParse(_adjusted.text.trim()),
      };
      await ref.read(repositoryProvider).verifyFuel(widget.purchaseId, body);
      if (!mounted) return;
      ref.invalidate(adminFuelInboxProvider);
      bumpAdminRevision(ref, 'fuel');
      Navigator.of(context).pop();
    } on HelixError catch (e) {
      if (mounted) showHelixError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _askRejectReason() async {
    if (!adminCan(ref, 'fuel:verify')) return;
    final strings = context.s;
    final reason = await SheetHost.show<String>(
      context: context,
      title: strings.t('detail.rejectReason'),
      child: AdminReasonForm(
        label: strings.t('detail.rejectReason'),
        submitLabel: strings.t('admin.reject'),
      ),
    );
    if (reason == null || reason.trim().isEmpty) return;
    await _verify(rejectReason: reason.trim());
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final canVerify = ref.watch(sessionProvider).permissions.contains('fuel:verify');
    final canAdjust = ref.watch(sessionProvider).permissions.contains('fuel:adjust');
    final canClear = ref.watch(sessionProvider).permissions.contains('fuel:clear_payment');
    final async = ref.watch(_purchaseProvider(widget.purchaseId));
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('review.fuel'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: Screen(
        refresh: () async => ref.invalidate(_purchaseProvider(widget.purchaseId)),
        child: async.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e),
          data: (row) {
            final confidence = fuelOcrConfidence(row);
            final gauge = fuelGaugePair(row);
            final litres = fuelLitres(row);
            final cost = fuelTotalCost(row);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                HelixText(row['driver_name']?.toString() ?? '', style: TypeScale.title(AppColors.text)),
                const SizedBox(height: AppSpace.s2),
                HelixText(
                  '${row['vehicle_plate'] ?? ''} · ${row['station_name'] ?? ''}',
                  style: TypeScale.caption(AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpace.s4),
                HelixCard(
                  child: Column(
                    children: [
                      KeyValueRow(label: strings.t('forms.litres'), value: litres == null ? '—' : '${Fmt.whole(litres)} L'),
                      KeyValueRow(label: strings.t('forms.cost'), value: Fmt.moneyParts(cost)),
                      KeyValueRow(label: strings.t('shift.odometer'), value: '${row['odometer_km'] ?? '—'}'),
                      KeyValueRow(
                        label: strings.t('forms.cardLast4'),
                        value: '${row['fuel_card_last_four'] ?? row['last_four'] ?? '—'}',
                      ),
                      KeyValueRow(
                        label: strings.t('admin.ocr'),
                        value: confidence == null ? '—' : Fmt.percent(confidence),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s4),
                if (gauge != null)
                  Row(
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          HelixText(strings.t('detail.gaugeBefore'), style: TypeScale.caption(AppColors.textSecondary)),
                          const SizedBox(height: AppSpace.s2),
                          AdminGaugeBar(percent: gauge.before),
                        ],
                      ),
                      const SizedBox(width: AppSpace.s5),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          HelixText(strings.t('detail.gaugeAfter'), style: TypeScale.caption(AppColors.textSecondary)),
                          const SizedBox(height: AppSpace.s2),
                          AdminGaugeBar(percent: gauge.after),
                        ],
                      ),
                      const SizedBox(width: AppSpace.s5),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          HelixText(strings.t('detail.gaugeDelta'), style: TypeScale.caption(AppColors.textSecondary)),
                          const SizedBox(height: AppSpace.s2),
                          HelixText(
                            Fmt.percent((gauge.after - gauge.before) / 100),
                            style: TypeScale.mono(AppColors.text),
                          ),
                        ],
                      ),
                    ],
                  ),
                const SizedBox(height: AppSpace.s4),
                if (row['receipt_media_object_id'] != null)
                  AdminMediaThumb(mediaId: row['receipt_media_object_id'].toString()),
                const SizedBox(height: AppSpace.s4),
                if (canAdjust) ...[
                  Field(
                    label: strings.t('detail.adjustLitres'),
                    controller: _adjusted,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: AppSpace.s4),
                ],
                if (canVerify) ...[
                  StrandButton(
                    label: strings.t('admin.verify'),
                    shell: Shell.admin,
                    busy: _busy,
                    onPressed: _busy ? null : () => _verify(),
                  ),
                  const SizedBox(height: AppSpace.s2),
                  QuietButton(
                    label: strings.t('admin.reject'),
                    busy: _busy,
                    onPressed: _busy ? null : _askRejectReason,
                  ),
                ],
                if (canClear) ...[
                  const SizedBox(height: AppSpace.s2),
                  QuietButton(
                    label: strings.t('admin.clearPayment'),
                    busy: _busy,
                    onPressed: _busy ? null : () => _verify(clearPayment: true),
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

final _purchaseProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  final page = await ref.watch(adminFuelInboxProvider.future);
  for (final row in page.data) {
    if (row['fuel_purchase_id'] == id) return row;
  }
  return {'fuel_purchase_id': id};
});
