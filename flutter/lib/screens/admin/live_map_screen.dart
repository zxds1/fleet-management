import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/config.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/card.dart';
import '../../design/components/segmented.dart';
import '../../design/components/states.dart';
import '../../design/components/status_badge.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Live fleet map. The vehicle's state is a colour AND a word on the marker,
/// never colour alone.
///
/// The map is drawn by `flutter_map`, which is pure Dart and needs no API
/// key: the OpenStreetMap tiles work out of the box, and a keyed tile
/// provider can be swapped in at build time with `--dart-define=MAP_TILE_URL`.
/// The map is a view, not the source of truth — the list beside it carries
/// the same information, and it is what an admin reads when the tiles cannot
/// load.
class LiveMapScreen extends ConsumerStatefulWidget {
  const LiveMapScreen({super.key});

  @override
  ConsumerState<LiveMapScreen> createState() => _LiveMapScreenState();
}

class _LiveMapScreenState extends ConsumerState<LiveMapScreen> {
  final _filters = <String>{};
  Map<String, dynamic>? _selected;
  bool _listMode = false;
  final MapController _map = MapController();

  static const _filterOrder = [
    'QUARANTINED',
    'OFFLINE',
    'HOS_ALERT',
    'SPEEDING',
    'MOVING',
    'IDLING',
    'PARKED',
  ];

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final states = ref.watch(vehicleStatesProvider);
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('nav.map'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: states.when(
        loading: () => const LoadingBody(),
        error: (e, _) => inlineError(context, e, retry: () => ref.invalidate(vehicleStatesProvider)),
        data: (rows) {
          final visible = rows
              .where((v) => _filters.isEmpty || _filters.contains(v['display_state']?.toString()))
              .toList();
          final withFix = visible
              .where((v) => v['latitude'] != null && v['longitude'] != null)
              .toList();
          final nullFix = visible
              .where((v) => v['latitude'] == null || v['longitude'] == null)
              .toList();

          final legend = Wrap(
            spacing: AppSpace.s2,
            runSpacing: AppSpace.s2,
            children: [
              for (final state in _filterOrder)
                _LegendChip(
                  label: strings.t('status.$state'),
                  glyph: _glyphFor(state),
                  color: _colorFor(state),
                  selected: _filters.contains(state),
                  onTap: () => setState(() {
                    if (_filters.contains(state)) {
                      _filters.remove(state);
                    } else {
                      _filters.add(state);
                    }
                  }),
                ),
            ],
          );

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpace.s3, AppSpace.s3, AppSpace.s3, 0),
                child: legend,
              ),
              const SizedBox(height: AppSpace.s3),
              Expanded(
                child: _listMode
                    ? _VehicleList(
                        vehicles: visible,
                        onSelect: (v) {
                          setState(() => _selected = v);
                          final lat = v['latitude'];
                          final lng = v['longitude'];
                          if (lat is num && lng is num) {
                            _map.move(LatLng(lat.toDouble(), lng.toDouble()), 13);
                          }
                        },
                      )
                    : Stack(
                        children: [
                          FlutterMap(
                            mapController: _map,
                            options: MapOptions(
                              initialCenter: const LatLng(-1.2921, 36.8219),
                              initialZoom: 9,
                              minZoom: 3,
                              maxZoom: 17,
                              onTap: (point, position) => setState(() => _selected = null),
                            ),
                            children: [
                              TileLayer(
                                urlTemplate: Config.mapTileUrl,
                                userAgentPackageName: 'com.helix.helix',
                              ),
                              MarkerLayer(
                                markers: [
                                  for (final v in withFix)
                                    Marker(
                                      point: LatLng(
                                        (v['latitude'] as num).toDouble(),
                                        (v['longitude'] as num).toDouble(),
                                      ),
                                      width: 120,
                                      height: 34,
                                      child: _FleetMarker(
                                        plate: v['plate']?.toString() ?? '—',
                                        state: v['display_state']?.toString(),
                                        selected: _selected?['vehicle_id'] == v['vehicle_id'],
                                        onTap: () => setState(() => _selected = v),
                                      ),
                                    ),
                                ],
                              ),
                              // The OpenStreetMap tile usage policy requires a
                              // visible attribution.
                              RichAttributionWidget(
                                attributions: [
                                  TextSourceAttribution(
                                    'OpenStreetMap contributors',
                                    onTap: () => Config.mapAttributionUrl,
                                  ),
                                ],
                              ),
                            ],
                          ),
                          if (nullFix.isNotEmpty)
                            Positioned(
                              top: AppSpace.s2,
                              left: AppSpace.s3,
                              right: AppSpace.s3,
                              child: HelixCard(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    HelixText(
                                      strings.t('map.noFixCount', {'n': '${nullFix.length}'}),
                                      style: TypeScale.caption(AppColors.textSecondary),
                                    ),
                                    for (final v in nullFix.take(4))
                                      Padding(
                                        padding: const EdgeInsets.only(top: AppSpace.s1),
                                        child: HelixText(
                                          '${v['plate']} — ${strings.t('status.OFFLINE')}',
                                          style: TypeScale.caption(AppColors.textSecondary),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          if (_selected != null)
                            Positioned(
                              left: AppSpace.s3,
                              right: AppSpace.s3,
                              bottom: AppSpace.s4,
                              child: _VehicleDrawer(
                                vehicle: _selected!,
                                onClose: () => setState(() => _selected = null),
                              ),
                            ),
                        ],
                      ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.s3, vertical: AppSpace.s2),
                  child: _MapListToggle(
                    listMode: _listMode,
                    onChanged: (value) => setState(() => _listMode = value),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  static Color _colorFor(String? state) => switch (state?.toUpperCase()) {
        'QUARANTINED' => AppColors.statusPlum,
        'OFFLINE' => AppColors.statusNeutral,
        'HOS_ALERT' => AppColors.statusAmber,
        'SPEEDING' => AppColors.statusDanger,
        'MOVING' => AppColors.statusOk,
        'IDLING' => AppColors.statusOlive,
        _ => AppColors.statusInfo,
      };

  static String _glyphFor(String state) => switch (state) {
        'QUARANTINED' => '✕',
        'OFFLINE' => '○',
        'HOS_ALERT' => '!',
        'SPEEDING' => '▲',
        'MOVING' => '►',
        'IDLING' => '❚❚',
        _ => 'P',
      };
}

/// A legend chip that filters. The word carries the meaning; the colour only
/// repeats it.
class _LegendChip extends StatelessWidget {
  const _LegendChip({
    required this.label,
    required this.glyph,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String glyph;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.full),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.s3, vertical: AppSpace.s2),
            decoration: BoxDecoration(
              color: selected ? AppColors.adminAccentQuiet : AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.full),
              border: Border.all(color: selected ? AppColors.adminAccent : AppColors.line),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                HelixText(glyph, style: TypeScale.numeral(color)),
                const SizedBox(width: AppSpace.s2),
                HelixText(label, style: TypeScale.caption(color)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The vehicle marker: the plate, a status dot, and the word on tap. The
/// colour is the product's own status colour, not a third-party hue.
class _FleetMarker extends StatelessWidget {
  const _FleetMarker({
    required this.plate,
    required this.state,
    required this.selected,
    required this.onTap,
  });

  final String plate;
  final String? state;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _LiveMapScreenState._colorFor(state);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.s2, vertical: 2),
        decoration: BoxDecoration(
          color: selected ? AppColors.adminAccentQuiet : AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: selected ? AppColors.adminAccent : AppColors.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: AppSpace.s1),
            HelixText(plate, style: TypeScale.caption(AppColors.text)),
          ],
        ),
      ),
    );
  }
}

/// Map or list. The list is not a fallback for a broken map — it is the
/// faster read for an admin scanning the fleet.
class _MapListToggle extends StatelessWidget {
  const _MapListToggle({required this.listMode, required this.onChanged});

  final bool listMode;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Segmented<bool>(
      options: [
        SegmentedOption(false, strings.t('map.viewMap')),
        SegmentedOption(true, strings.t('map.viewList')),
      ],
      value: listMode,
      onChanged: onChanged,
    );
  }
}

/// The fleet as a list: the same information as the map, in a form that
/// works without tiles.
class _VehicleList extends StatelessWidget {
  const _VehicleList({required this.vehicles, required this.onSelect});

  final List<Map<String, dynamic>> vehicles;
  final ValueChanged<Map<String, dynamic>> onSelect;

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    if (vehicles.isEmpty) {
      return EmptyState(message: strings.t('state.empty'));
    }
    return ListView.separated(
      itemCount: vehicles.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final v = vehicles[index];
        final parsed = vehicleStateFromName(v['display_state'] as String?);
        return ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: AppSpace.s3),
          title: HelixText(
            '${v['plate'] ?? '—'}',
            style: TypeScale.bodyStrong(AppColors.text),
          ),
          subtitle: HelixText(
            v['latitude'] == null
                ? strings.t('map.noFix')
                : '${v['latitude']}, ${v['longitude']}',
            style: TypeScale.caption(AppColors.textSecondary),
          ),
          trailing: parsed == null ? null : StatusBadge(state: parsed, dense: true),
          onTap: () => onSelect(v),
        );
      },
    );
  }
}

class _VehicleDrawer extends StatelessWidget {
  const _VehicleDrawer({required this.vehicle, required this.onClose});

  final Map<String, dynamic> vehicle;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final parsed = vehicleStateFromName(vehicle['display_state'] as String?);
    return HelixCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (parsed != null) StatusBadge(state: parsed, dense: true),
              const Spacer(),
              IconButton(
                icon: Icon(Icons.close_rounded, color: AppColors.textSecondary),
                onPressed: onClose,
              ),
            ],
          ),
          HelixText('${vehicle['plate'] ?? ''}', style: TypeScale.title(AppColors.text)),
          const SizedBox(height: AppSpace.s2),
          KeyValueRow(
            label: strings.t('drivers.title'),
            value: vehicle['driver_name']?.toString() ?? '—',
            mono: false,
          ),
          KeyValueRow(
            label: strings.t('detail.position'),
            value: '${vehicle['latitude'] ?? '—'}, ${vehicle['longitude'] ?? '—'}',
          ),
          KeyValueRow(
            label: strings.t('detail.hos'),
            value: Fmt.dateTime(
              DateTime.tryParse(vehicle['next_eligible_clock_in_at']?.toString() ?? ''),
            ),
            mono: false,
          ),
          KeyValueRow(
            label: strings.t('shift.odometer'),
            value: '${vehicle['odometer_km'] ?? '—'}',
          ),
          if (vehicle['quarantine_reason'] != null)
            KeyValueRow(
              label: strings.t('detail.quarantine'),
              value: vehicle['quarantine_reason'].toString(),
              mono: false,
            ),
        ],
      ),
    );
  }
}
