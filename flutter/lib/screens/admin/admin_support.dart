import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/container.dart';
import '../../app/providers.dart';
import '../../core/policy.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/field.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Local support for the admin shell: permission gates that read the CURRENT
/// session, list providers that can be invalidated, tolerant row readers and
/// the two small widgets the admin screens need that the shared design
/// components do not provide.

// ── Permission gates ──────────────────────────────────────────────────────

/// The session provider is a plain [Provider] over a [ChangeNotifier], so a
/// build-time read of the permission list can be stale. Every gate re-reads
/// the live set at the moment of the tap, so a stale build can never let an
/// action through.
bool adminCan(WidgetRef ref, String permission) =>
    ref.read(sessionProvider).permissions.contains(permission);

// ── List invalidation ─────────────────────────────────────────────────────

/// Bumped by a detail screen after a successful write. The queue it came
/// from watches this value, so a cleared row is never shown again.
final adminRevisionProvider = StateProvider.family<int, String>((ref, key) => 0);

void bumpAdminRevision(WidgetRef ref, String key) {
  ref.read(adminRevisionProvider(key).notifier).state++;
}

// ── Tolerant row readers ──────────────────────────────────────────────────

/// Postgres numeric columns arrive as JSON strings on some routes and as
/// numbers on others. Every numeric read goes through this, so a string can
/// never throw a cast error.
double? adminNum(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

int? adminInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value.trim());
  return null;
}

/// A list body is either a bare array or the cursor envelope. Both are read
/// here so a route can change its shape without emptying the screen.
List<Map<String, dynamic>> adminRows(Object? body) {
  final list = body is List ? body : (body is Map ? body['data'] : null);
  if (list is! List) return const [];
  return list
      .whereType<Map>()
      .map((row) => row.map((key, value) => MapEntry(key.toString(), value)))
      .toList();
}

// ── Fuel row readers ──────────────────────────────────────────────────────
//
// `app.v_fuel_reconciliation_inbox` is the canonical fuel shape for the
// admin shell: litres, total_cost, ocr_confidence and the gauge percentages.
// The pending-review query aliases the same purchase under the legacy
// `amount_spent` / `liters_pumped` / `confidence_score` names, so both are
// accepted here and every fuel screen reads the same numbers.

double? fuelTotalCost(Map<String, dynamic> row) =>
    adminNum(row['total_cost']) ?? adminNum(row['amount_spent']);

double? fuelLitres(Map<String, dynamic> row) =>
    adminNum(row['litres']) ?? adminNum(row['liters_pumped']);

double? fuelOcrConfidence(Map<String, dynamic> row) =>
    adminNum(row['ocr_confidence']) ?? adminNum(row['confidence_score']);

double? fuelGaugeBefore(Map<String, dynamic> row) =>
    adminNum(row['gauge_before_percent']) ?? adminNum(row['gauge_before']);

double? fuelGaugeAfter(Map<String, dynamic> row) =>
    adminNum(row['gauge_after_percent']) ?? adminNum(row['gauge_after']);

/// The gauge pair as percentages, or null when the purchase recorded none.
({double before, double after})? fuelGaugePair(Map<String, dynamic> row) {
  final before = fuelGaugeBefore(row);
  final after = fuelGaugeAfter(row);
  if (before == null && after == null) return null;
  return (before: before ?? 0, after: after ?? 0);
}

// ── List providers ────────────────────────────────────────────────────────

final adminAccidentsProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).accidents(ownScope: false);
});

final adminShiftsProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page(
    'shifts/verification-inbox',
    query: {'verification_status': 'PENDING'},
  );
});

final adminInspectionsProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page('inspections', query: {'state': 'SUBMITTED'});
});

final adminFuelInboxProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page(
    'fuel/reconciliation-inbox',
    query: {'verified': 'false'},
  );
});

final adminMaintenanceProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page('maintenance');
});

final adminTrainingLessonsProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page('training/lessons');
});

final adminTrainingRosterProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page('training/roster');
});

final adminDriversProvider = FutureProvider<CursorPage<Map<String, dynamic>>>((ref) async {
  return ref.watch(repositoryProvider).page('drivers');
});

final adminVehicleIssuesProvider =
    FutureProvider.family<CursorPage<Map<String, dynamic>>, String>((ref, vehicleId) async {
  return ref.watch(repositoryProvider).page('vehicles/$vehicleId/issues');
});

/// The privacy request list. `tenant` switches between the caller's own
/// requests and the tenant-wide queue.
final adminPrivacyRequestsProvider =
    FutureProvider.family<CursorPage<Map<String, dynamic>>, bool>((ref, tenant) async {
  return ref.watch(repositoryProvider).page(tenant ? 'privacy/requests' : 'privacy/export-request');
});

/// The vehicle fleet. `GET /vehicles` answers with either a bare array or the
/// cursor envelope depending on the deployment, so both are accepted.
final adminVehiclesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final body = await ref.watch(containerProvider).api.get<dynamic>(
    'vehicles',
    query: {'limit': Policy.listPageSize},
    parse: (b) => b,
  );
  return adminRows(body);
});

// ── Status visuals ────────────────────────────────────────────────────────

/// The design system's colour and glyph for a vehicle display state. The
/// shared StatusBadge keeps its palette private, so the admin shell mirrors
/// it here — same tokens, same glyphs, never colour alone.
({Color color, String glyph}) adminVehicleStateVisual(String? name) =>
    switch (name?.toUpperCase()) {
      'QUARANTINED' => (color: AppColors.statusPlum, glyph: '✕'),
      'OFFLINE' => (color: AppColors.statusNeutral, glyph: '○'),
      'HOS_ALERT' => (color: AppColors.statusAmber, glyph: '!'),
      'SPEEDING' => (color: AppColors.statusDanger, glyph: '▲'),
      'MOVING' => (color: AppColors.statusOk, glyph: '►'),
      'IDLING' => (color: AppColors.statusOlive, glyph: '❚❚'),
      'PARKED' => (color: AppColors.statusInfo, glyph: 'P'),
      _ => (color: AppColors.statusNeutral, glyph: '•'),
    };

/// The design system's colour and glyph for a vehicle's fleet status.
({Color color, String glyph}) adminVehicleStatusVisual(String? status) =>
    switch (status?.toUpperCase()) {
      'AVAILABLE' => (color: AppColors.statusOk, glyph: '✓'),
      'IN_USE' => (color: AppColors.statusInfo, glyph: '►'),
      'MAINTENANCE' => (color: AppColors.statusAmber, glyph: '⚙'),
      'QUARANTINED' => (color: AppColors.statusPlum, glyph: '✕'),
      'RETIRED' => (color: AppColors.statusNeutral, glyph: '–'),
      'EXTERNAL' => (color: AppColors.statusNeutral, glyph: '↗'),
      _ => (color: AppColors.statusNeutral, glyph: '•'),
    };

/// The localised label for a vehicle's fleet status.
String adminVehicleStatusLabel(BuildContext context, String? status) {
  final strings = context.s;
  return switch (status?.toUpperCase()) {
    'AVAILABLE' => strings.t('vehicle.statusAvailable'),
    'IN_USE' => strings.t('vehicle.statusInUse'),
    'MAINTENANCE' => strings.t('vehicle.statusMaintenance'),
    'QUARANTINED' => strings.t('vehicle.statusQuarantined'),
    'RETIRED' => strings.t('vehicle.statusRetired'),
    'EXTERNAL' => strings.t('vehicle.statusExternal'),
    _ => status ?? '—',
  };
}

/// A chip that carries a glyph AND a word, so a status is never colour alone.
class AdminStatusChip extends StatelessWidget {

  const AdminStatusChip({
    super.key,
    required this.label,
    required this.glyph,
    required this.color,
    this.semanticsLabel,
  });

  final String label;
  final String glyph;
  final Color color;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel ?? label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.s3, vertical: AppSpace.s1),
        constraints: const BoxConstraints(minHeight: AppTarget.badge),
        decoration: BoxDecoration(
          color: AppColors.surfaceSunk,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: AppColors.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            HelixText(glyph, style: TypeScale.mono(color)),
            const SizedBox(width: AppSpace.s2),
            HelixText(label, style: TypeScale.caption(color)),
          ],
        ),
      ),
    );
  }
}

/// A horizontal gauge bar for a percentage reading (0–100). The shared
/// GaugeBar draws the five-step enum, but the fuel view reports a percentage.
class AdminGaugeBar extends StatelessWidget {
  const AdminGaugeBar({super.key, required this.percent, this.width = 96});

  final double? percent;
  final double width;

  @override
  Widget build(BuildContext context) {
    final value = (percent ?? 0).clamp(0.0, 100.0) / 100.0;
    return Container(
      height: 10,
      width: width,
      decoration: BoxDecoration(
        color: AppColors.surfaceSunk,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: Border.all(color: AppColors.line),
      ),
      child: Align(
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(
          widthFactor: value,
          child: Container(
            decoration: BoxDecoration(
              color: AppColors.statusOk,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
          ),
        ),
      ),
    );
  }
}

/// A media thumbnail that resolves its URL through the API client. The shared
/// MediaThumb looks the client up through an inherited widget that the app
/// root does not construct, so the admin screens resolve it locally.
class AdminMediaThumb extends ConsumerStatefulWidget {
  const AdminMediaThumb({super.key, required this.mediaId, this.size = 72});

  final String mediaId;
  final double size;

  @override
  ConsumerState<AdminMediaThumb> createState() => _AdminMediaThumbState();
}

class _AdminMediaThumbState extends ConsumerState<AdminMediaThumb> {
  String? _url;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  @override
  void didUpdateWidget(AdminMediaThumb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.mediaId != widget.mediaId) {
      _url = null;
      _failed = false;
      _resolve();
    }
  }

  Future<void> _resolve() async {
    try {
      final url = await ref.read(containerProvider).api.resolveMediaUrl(widget.mediaId);
      if (!mounted) return;
      setState(() => _url = url);
    } catch (_) {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(
        color: AppColors.surfaceSunk,
        borderRadius: BorderRadius.circular(AppRadius.control),
        border: Border.all(color: AppColors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: _url == null
          ? Center(
              child: Icon(
                _failed ? Icons.broken_image_rounded : Icons.image_rounded,
                color: AppColors.textTertiary,
              ),
            )
          : Image.network(_url!, fit: BoxFit.cover),
    );
  }
}

/// A reason form for a modal sheet. It pops the SHEET with the trimmed
/// reason, and refuses to close on an empty one, so a caller can never get a
/// null reason back and silently skip the action it asked for.
class AdminReasonForm extends StatefulWidget {
  const AdminReasonForm({super.key, this.submitLabel, this.label});

  final String? submitLabel;
  final String? label;

  @override
  State<AdminReasonForm> createState() => _AdminReasonFormState();
}

class _AdminReasonFormState extends State<AdminReasonForm> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (value.isEmpty) {
      setState(() => _error = context.s.error('VALIDATION_ERROR'));
      return;
    }
    Navigator.of(context, rootNavigator: true).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Field(
            label: widget.label ?? strings.t('detail.rejectReason'),
            controller: _controller,
            maxLines: 3,
            required: true,
            errorText: _error,
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
          const SizedBox(height: AppSpace.s4),
          StrandButton(
            label: widget.submitLabel ?? strings.t('actions.submit'),
            shell: Shell.admin,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}

/// Renders a status-coloured map pin. The pin is drawn from the design
/// system's own colour rather than Google's default hue palette; the hue
/// marker is only the fallback when the bitmap cannot be produced.
Future<ui.Image> adminPinImage(Color color, {double size = 48}) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final centre = Offset(size / 2, size / 2);
  final radius = size * 0.34;
  canvas.drawCircle(centre, radius + size * 0.06, Paint()..color = AppColors.surface);
  canvas.drawCircle(centre, radius, Paint()..color = color);
  final picture = recorder.endRecording();
  return picture.toImage(size.toInt(), size.toInt());
}

Future<Uint8List?> adminPinBytes(Color color, {double size = 48}) async {
  final image = await adminPinImage(color, size: size);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  return data?.buffer.asUint8List();
}
