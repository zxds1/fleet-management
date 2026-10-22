import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/media.dart';
import '../../core/offline/queue.dart';
import '../../design/components/buttons.dart';
import '../../design/components/field.dart';
import '../../design/components/form_shell.dart';
import '../../design/components/photo_capture.dart';
import '../../design/components/screen.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/components/skeleton.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// Photo-first refuel: receipt photo → pump photo → odometer reading → card picker
/// (last-4 typed) → purchased-at → submit. Two staged photos (receipt + pump), one write.
class RefuelScreen extends ConsumerStatefulWidget {
  const RefuelScreen({super.key});

  @override
  ConsumerState<RefuelScreen> createState() => _RefuelScreenState();
}

class _RefuelScreenState extends ConsumerState<RefuelScreen> {
  final _formKey = GlobalKey<FormShellState>();
  final _odometer = TextEditingController();
  final _litres = TextEditingController();
  final _cost = TextEditingController();
  final _last4 = TextEditingController();
  final _station = TextEditingController();
  final _purchasedAt = TextEditingController();
  XFile? _receipt;
  XFile? _pump;
  String? _cardId;
  bool _busy = false;

  Future<void> _pickCard(List<Map<String, dynamic>> cards) async {
    final picked = await SheetHost.show<String>(
      context: context,
      title: context.s.t('forms.pickCard'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final card in cards)
            ListTile(
              title: HelixText(card['label']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
              subtitle: HelixText(
                '${card['provider'] ?? ''}${card['is_pooled'] == true ? ' · ${context.s.t('forms.pooled')}' : ''}',
                style: TypeScale.caption(AppColors.textSecondary),
              ),
              onTap: () => Navigator.of(context).pop(card['id'] as String),
            ),
        ],
      ),
    );
    if (picked != null) setState(() => _cardId = picked);
  }

  /// The driver types the time they fuelled. A naive entry is read as UTC so
  /// the server always receives one, unambiguous, ISO-8601 UTC timestamp.
  DateTime? _parsePurchasedAt(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;
    final parsed = DateTime.tryParse(text);
    if (parsed == null) return null;
    return parsed.isUtc
        ? parsed
        : DateTime.utc(
            parsed.year,
            parsed.month,
            parsed.day,
            parsed.hour,
            parsed.minute,
            parsed.second,
            parsed.millisecond,
          );
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final strings = context.s;
    try {
      final km = int.tryParse(_odometer.text.trim());
      final shift = await ref.read(activeShiftProvider.future);
      final vehicleId = shift?['vehicle_id'] as String?;
      if (km == null || _receipt == null || _pump == null || vehicleId == null) return;

      final media = ref.read(mediaProvider);
      final receipt = await media.stageCapture(
            await _receipt!.readAsBytes(),
            slot: MediaService.slotReceipt,
            ownerKind: MediaService.ownerFuelReceipt,
            retentionClass: MediaService.retentionReceipt,
          );
      final pump = await media.stageCapture(
            await _pump!.readAsBytes(),
            slot: MediaService.slotPump,
            ownerKind: MediaService.ownerFuelOdometer,
            retentionClass: MediaService.retentionDashboard,
          );
      if (receipt == null || pump == null) {
        throw HelixError(code: 'UPLOAD_UNAVAILABLE', status: 0);
      }
      final litres = Fmt.parseDecimal(_litres.text);
      final cost = Fmt.parseDecimal(_cost.text);
      final station = _station.text.trim();
      final last4 = _last4.text.trim();
      final purchasedAt = _parsePurchasedAt(_purchasedAt.text) ?? DateTime.now().toUtc();
      final ops = <QueueOp>[
        QueueOp(
          method: 'POST',
          path: 'driver/fuel/purchase',
          body: {
            'shift_id': shift?['shift_id'],
            'vehicle_id': vehicleId,
            'odometer_reading': km,
            'receipt_media_object_id': receipt.slot,
            // A1.4 v2: the pump photograph replaces the odometer gauge photo.
            // The pump reading is what the OCR reads for litres, cost, date
            // and station.
            'pump_photo_media_object_id': pump.slot,
            'purchased_at': purchasedAt.toUtc().toIso8601String(),
            // The card is identified by its last four digits, never by its id.
            if (RegExp(r'^\d{4}$').hasMatch(last4)) 'fuel_card_last_four': last4,
          },
          uploads: [receipt, pump],
          produces: 'fuel_purchase_id',
        ),
      ];
      // The purchase endpoint takes the photos and the odometer only: litres,
      // amount and station are the driver's correction of the OCR result.
      if (litres != null || cost != null || station.isNotEmpty) {
        ops.add(QueueOp(
          method: 'POST',
          path: 'driver/fuel/correct',
          body: {
            'purchase_id': 'fuel_purchase_id',
            'corrected_amount': ?cost,
            'corrected_liters': ?litres,
            if (station.isNotEmpty) 'corrected_station': station,
            'corrected_date': purchasedAt.toUtc().toIso8601String().substring(0, 10),
          },
          needs: const ['fuel_purchase_id'],
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

  List<String> _missing() {
    final strings = context.s;
    final missing = <String>[];
    if (_receipt == null) missing.add(strings.t('forms.receipt'));
    if (_pump == null) missing.add(strings.t('forms.pump'));
    if (int.tryParse(_odometer.text.trim()) == null) missing.add(strings.t('shift.odometer'));
    if (_cardId != null && !RegExp(r'^\d{4}$').hasMatch(_last4.text.trim())) {
      missing.add(strings.t('forms.cardLast4'));
    }
    if (_purchasedAt.text.trim().isNotEmpty && _parsePurchasedAt(_purchasedAt.text) == null) {
      missing.add(strings.t('forms.purchasedAt'));
    }
    return missing;
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final missing = _missing();
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('forms.titleRefuel'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        child: FormShell(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PhotoCapture(
                cameras: ref.watch(camerasProvider).valueOrNull ?? const [],
                label: strings.t('forms.receipt'),
                captured: _receipt,
                onCaptured: (file) => setState(() => _receipt = file),
              ),
              const SizedBox(height: AppSpace.s4),
              PhotoCapture(
                cameras: ref.watch(camerasProvider).valueOrNull ?? const [],
                label: strings.t('forms.pump'),
                captured: _pump,
                onCaptured: (file) => setState(() => _pump = file),
              ),
              const SizedBox(height: AppSpace.s4),
              Field(
                label: strings.t('shift.odometer'),
                controller: _odometer,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: AppSpace.s4),
              Field(
                label: strings.t('forms.litres'),
                controller: _litres,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                errorText: _numberError(_litres.text),
              ),
              const SizedBox(height: AppSpace.s4),
              Field(
                label: strings.t('forms.cost'),
                controller: _cost,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                errorText: _numberError(_cost.text),
              ),
              const SizedBox(height: AppSpace.s4),
              Consumer(
                builder: (context, ref, _) {
                  final cards = ref.watch(fuelCardsProvider);
                  return cards.when(
                    loading: () => Skeleton(height: 56),
                    error: (e, _) => inlineError(context, e),
                    data: (cardsList) => OutlinedButton.icon(
                      icon: Icon(Icons.credit_card_rounded, color: AppColors.textSecondary),
                      label: HelixText(
                        _cardId != null
                            ? cardsList.firstWhere((c) => c['id'] == _cardId, orElse: () => {'label': '?'})['label']?.toString() ?? ''
                            : strings.t('forms.pickCard'),
                        style: TypeScale.body(AppColors.text),
                      ),
                      onPressed: () => _pickCard(cardsList),
                    ),
                  );
                },
              ),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('forms.cardLast4'), controller: _last4, keyboardType: TextInputType.number),
              const SizedBox(height: AppSpace.s4),
              Field(label: strings.t('forms.station'), controller: _station),
              const SizedBox(height: AppSpace.s4),
              Field(
                label: strings.t('forms.purchasedAt'),
                controller: _purchasedAt,
                keyboardType: TextInputType.datetime,
              ),
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
                onPressed: (missing.isNotEmpty || _busy) ? null : _submit,
                busy: _busy,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _numberError(String raw) {
    if (raw.trim().isEmpty) return null;
    return Fmt.parseDecimal(raw) == null ? context.s.t('forms.badNumber') : null;
  }
}
