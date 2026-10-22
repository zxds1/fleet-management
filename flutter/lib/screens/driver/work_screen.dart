import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/screen.dart';
import '../../design/tokens.dart';
import '../../design/components/text.dart';
import '../common.dart';

/// Work hub: the driver's two daily tasks (refuel, DVIR/inspect) plus the
/// secondary vehicle tasks. One tap per intent.
class WorkScreen extends StatelessWidget {
  const WorkScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Screen(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          HelixText(strings.t('nav.work'), style: TypeScale.display(AppColors.text)),
          const SizedBox(height: AppSpace.s5),

          // ── primary: the two daily tasks ──
          StrandButton(
            label: strings.t('nav.refuel'),
            icon: const Icon(Icons.local_gas_station_rounded, size: 20),
            shell: Shell.driver,
            onPressed: () => context.push('/driver/refuel'),
          ),
          const SizedBox(height: AppSpace.s3),
          StrandButton(
            label: strings.t('nav.inspect'),
            icon: const Icon(Icons.fact_check_rounded, size: 20),
            shell: Shell.driver,
            onPressed: () => context.push('/driver/inspect'),
          ),

          // ── secondary: vehicle tasks ──
          const SizedBox(height: AppSpace.s5),
          HelixCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                HelixText(strings.t('nav.more'), style: TypeScale.lead(AppColors.text)),
                const SizedBox(height: AppSpace.s3),
                _HubRow(label: strings.t('swap.title'), icon: Icons.local_shipping_rounded, route: '/driver/trailer-swap'),
                Divider(height: 1, color: AppColors.line),
                _HubRow(label: strings.t('vehicle.title'), icon: Icons.directions_bus_rounded, route: '/driver/my-vehicle'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HubRow extends StatelessWidget {
  const _HubRow({required this.label, required this.icon, required this.route});

  final String label;
  final IconData icon;
  final String route;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, size: 20, color: AppColors.textSecondary),
      title: HelixText(label, style: TypeScale.body(AppColors.text)),
      trailing: Icon(Icons.chevron_right_rounded, size: 20, color: AppColors.textSecondary),
      onTap: () => context.push(route),
    );
  }
}
