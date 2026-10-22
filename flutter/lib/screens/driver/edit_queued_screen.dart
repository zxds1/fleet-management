import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/container.dart';
import '../../core/offline/queue_store.dart';
import '../../design/components/buttons.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/states.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Editor for a FAILED_REVIEW row: flattens the body to `path › key` fields.
/// Saving assigns a NEW idempotency key, then drains.
class EditQueuedScreen extends ConsumerStatefulWidget {
  const EditQueuedScreen({super.key, required this.id});

  final int id;

  @override
  ConsumerState<EditQueuedScreen> createState() => _EditQueuedScreenState();
}

class _EditQueuedScreenState extends ConsumerState<EditQueuedScreen> {
  final _controllers = <String, TextEditingController>{};
  final _keys = <String>[];
  final _numericKeys = <String>{};
  QueueItem? _item;
  bool _loading = true;
  bool _gone = false;

  /// Body keys are snake_case wire names; the label is the driver's word.
  static const Map<String, String> _labels = {
    'start_odometer_km': 'shift.odometer',
    'end_odometer_km': 'shift.odometer',
    'odometer_reading': 'shift.odometer',
    'driver_statement': 'accident.statement',
    'witness_name': 'accident.witness',
    'third_party_plate': 'accident.plate',
    'planned_notes': 'shift.notes',
    'debrief_notes': 'shift.notes',
    'signature_name': 'forms.signature',
    'mayday_reason': 'accident.reason',
    'vehicle_id': 'vehicle.title',
    'shift_id': 'shifts.title',
    'litres': 'forms.litres',
    'cost': 'forms.cost',
    'station': 'forms.station',
    'fuel_card_last_four': 'forms.cardLast4',
    'purchased_at': 'forms.purchasedAt',
    'template_id': 'forms.template',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final item = await ref.read(containerProvider).queue.itemById(widget.id);
    if (!mounted) return;
    if (item == null) {
      setState(() {
        _loading = false;
        _gone = true;
      });
      return;
    }
    _item = item;
    item.body.forEach((key, value) {
      if (value is String) {
        _keys.add(key);
        _controllers[key] = TextEditingController(text: value);
      } else if (value is num) {
        // A number the server rejected is the value the driver has to fix.
        _keys.add(key);
        _numericKeys.add(key);
        _controllers[key] = TextEditingController(text: '$value');
      }
    });
    setState(() => _loading = false);
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final item = _item;
    if (item == null) return;
    final queue = ref.read(containerProvider).queue;
    final body = Map<String, dynamic>.of(item.body);
    for (final key in _keys) {
      final text = _controllers[key]!.text.trim();
      if (_numericKeys.contains(key)) {
        body[key] = num.tryParse(text) ?? text;
      } else {
        body[key] = text;
      }
    }
    await queue.edit(widget.id, body);
    await queue.drain();
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    if (_loading) return const Scaffold(body: LoadingBody());
    if (_gone || _item == null) {
      return Scaffold(
        appBar: AppBar(title: HelixText(strings.t('outbox.edit'), style: TypeScale.title(AppColors.text))),
        body: Screen(child: EmptyState(message: strings.t('state.empty'))),
      );
    }
    return Scaffold(
      appBar: AppBar(title: HelixText(_item!.path, style: TypeScale.title(AppColors.text))),
      body: Screen(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final key in _keys) ...[
              Field(
                label: strings.t(_labels[key] ?? key),
                controller: _controllers[key],
                keyboardType: _numericKeys.contains(key)
                    ? const TextInputType.numberWithOptions(decimal: true)
                    : TextInputType.text,
              ),
              const SizedBox(height: AppSpace.s4),
            ],
            const SizedBox(height: AppSpace.s4),
            StrandButton(label: strings.t('actions.save'), shell: Shell.driver, onPressed: _save),
          ],
        ),
      ),
    );
  }
}
