import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/chips.dart';
import '../../design/components/screen.dart';
import '../../design/tokens.dart';
import '../../design/components/text.dart';
import '../common.dart';

/// Safety hub: incident reporting plus the write queues that need the
/// driver's attention. Everything here is one tap away.
class SafetyScreen extends ConsumerWidget {
  const SafetyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final outboxCount = ref.watch(outboxCountProvider).valueOrNull ?? 0;
    return Screen(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          HelixText(strings.t('nav.safety'), style: TypeScale.display(AppColors.text)),
          const SizedBox(height: AppSpace.s5),

          // ── primary: incident report ──
          StrandButton(
            label: strings.t('nav.accidents'),
            icon: const Icon(Icons.warning_amber_rounded, size: 20),
            shell: Shell.driver,
            onPressed: () => context.push('/driver/accidents'),
          ),

          // ── secondary: queues ──
          const SizedBox(height: AppSpace.s5),
          HelixCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                HelixText(strings.t('nav.more'), style: TypeScale.lead(AppColors.text)),
                const SizedBox(height: AppSpace.s3),
                _SafetyRow(
                  label: strings.t('outbox.title'),
                  icon: Icons.send_rounded,
                  badge: outboxCount > 0 ? '${strings.t('outbox.title')} · $outboxCount' : null,
                  route: '/driver/outbox',
                ),
                Divider(height: 1, color: AppColors.line),
                _SafetyRow(
                  label: strings.t('nav.inbox'),
                  icon: Icons.inbox_rounded,
                  badge: null,
                  route: '/driver/inbox',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SafetyRow extends StatelessWidget {
  const _SafetyRow({required this.label, required this.icon, this.badge, required this.route});

  final String label;
  final IconData icon;
  final String? badge;
  final String route;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, size: 20, color: AppColors.textSecondary),
      title: HelixText(label, style: TypeScale.body(AppColors.text)),
      trailing: badge == null
          ? Icon(Icons.chevron_right_rounded, size: 20, color: AppColors.textSecondary)
          : PendingChip(label: badge!),
      onTap: () => context.push(route),
    );
  }
}
