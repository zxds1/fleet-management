import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/providers.dart';
import '../../design/components/card.dart';
import '../../design/components/screen.dart';
import '../../design/components/states.dart';
import '../../design/components/status_badge.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// The driver's own vehicle row (driver-scoped vehicle-states), with honest
/// OFFLINE and stale-data cards instead of a floating null-fix pin.
class MyVehicleScreen extends ConsumerWidget {
  const MyVehicleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final states = ref.watch(myVehicleProvider);
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('vehicle.title'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        offlineCopy: true,
        refresh: () async => ref.invalidate(myVehicleProvider),
        child: states.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e, retry: () => ref.invalidate(myVehicleProvider)),
          data: (vehicle) {
            if (vehicle == null) {
              return EmptyState(message: strings.t('vehicle.none'));
            }
            final lat = vehicle['latitude'] as num?;
            final lng = vehicle['longitude'] as num?;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    VehicleStateChip(vehicle['display_state'] as String?),
                  ],
                ),
                const SizedBox(height: AppSpace.s3),
                if (lat == null || lng == null)
                  HelixCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        HelixChip(label: strings.t('status.OFFLINE'), color: AppColors.statusNeutral, glyph: '○'),
                        const SizedBox(height: AppSpace.s3),
                        HelixText(
                          strings.t('detail.noData'),
                          style: TypeScale.body(AppColors.textSecondary),
                        ),
                      ],
                    ),
                  )
                else ...[
                  KeyValueRow(label: strings.t('detail.position'), value: '$lat, $lng'),
                  KeyValueRow(label: strings.t('shift.odometer'), value: '${vehicle['odometer_km'] ?? '—'}'),
                  if (vehicle['next_eligible_clock_in_at'] != null)
                    KeyValueRow(
                      label: strings.t('detail.hos'),
                      value: '${vehicle['next_eligible_clock_in_at']}',
                    ),
                ],
                const SizedBox(height: AppSpace.s4),
                HelixText(strings.t('vehicle.stale'), style: TypeScale.caption(AppColors.textSecondary)),
              ],
            );
          },
        ),
      ),
    );
  }
}

