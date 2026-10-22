import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../data/providers.dart';
import '../../design/components/card.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';
import 'admin_support.dart';

/// Admin Overview: attention cards, fleet status row, KPI strip. Admin shell =
/// violet strand.
class AdminOverviewScreen extends ConsumerWidget {
  const AdminOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final analyticsAsync = ref.watch(analyticsProvider);
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('tabs.overview'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.frostChrome,
        iconTheme: IconThemeData(color: AppColors.text),
        foregroundColor: AppColors.text,
      ),
      body: Screen(
        refresh: () async => ref.invalidate(analyticsProvider),
        child: analyticsAsync.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e, retry: () => ref.invalidate(analyticsProvider)),
          data: (a) {
            final kpis = a['kpis'] as Map<String, dynamic>? ?? const {};
            final accidents = adminInt(kpis['open_accidents']) ?? adminInt(a['open_accidents']) ?? 0;
            final dvir = adminInt(kpis['pending_dvir']) ?? adminInt(a['pending_dvir']) ?? 0;
            final anomalies = adminInt(kpis['anomalies']) ?? adminInt(a['anomalies_open']) ?? 0;
            final docs = adminInt(kpis['expiring_docs']) ?? adminInt(a['expiring_docs']) ?? 0;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ScreenHeader(strings.t('dash.attention')),
                // Two rows of flexible cards — a fixed aspect ratio would
                // overflow at a larger text scale or a longer caption.
                // IntrinsicHeight gives the row a bounded height, so the
                // cards in a row line up and the stretched cross axis is
                // legal inside a scrolling column.
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: _AttentionCard(
                          label: strings.t('admin.accidents'),
                          count: accidents,
                          exact: true,
                          color: AppColors.statusDanger,
                          onTap: () => context.push('/admin/accidents'),
                        ),
                      ),
                      const SizedBox(width: AppSpace.s3),
                      Expanded(
                        child: _AttentionCard(
                          label: strings.t('review.inspections'),
                          count: dvir,
                          exact: true,
                          color: AppColors.statusWarn,
                          onTap: () => context.push('/admin/review'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s3),
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: _AttentionCard(
                          label: strings.t('review.fuel'),
                          count: anomalies,
                          exact: false,
                          color: AppColors.statusAmber,
                          onTap: () => context.push('/admin/fuel-pending'),
                        ),
                      ),
                      const SizedBox(width: AppSpace.s3),
                      Expanded(
                        child: _AttentionCard(
                          label: strings.t('docs.title'),
                          count: docs,
                          exact: true,
                          color: AppColors.statusInfo,
                          onTap: () => context.push('/admin/inbox?initial=docs'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s5),
                ScreenHeader(strings.t('dashDetail.title')),
                HelixCard(
                  child: Column(
                    children: [
                      KeyValueRow(label: strings.t('dashDetail.distanceKm'), value: '${kpis['distanceKm'] ?? '—'}'),
                      KeyValueRow(label: strings.t('dashDetail.fuelCost'), value: '${kpis['fuelCost'] ?? '—'}'),
                      KeyValueRow(label: strings.t('dashDetail.anomalies'), value: '${kpis['anomalies'] ?? '—'}'),
                      KeyValueRow(label: strings.t('dashDetail.vehicles'), value: '${kpis['vehicles'] ?? '—'}'),
                      KeyValueRow(label: strings.t('dashDetail.drivers'), value: '${kpis['drivers'] ?? '—'}'),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.s5),
                ScreenHeader(strings.t('dash.fleet')),
                HelixCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _FleetLink(
                        label: strings.t('admin.fleetAccidents'),
                        onTap: () => context.push('/admin/accidents'),
                      ),
                      _FleetLink(
                        label: strings.t('admin.fleetReview'),
                        onTap: () => context.push('/admin/review'),
                      ),
                      _FleetLink(
                        label: strings.t('admin.fleetMap'),
                        onTap: () => context.push('/admin/map'),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FleetLink extends StatelessWidget {
  const _FleetLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: HelixChip(label: label, color: AppColors.adminAccent, glyph: '►'),
      trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
      onTap: onTap,
    );
  }
}

class _AttentionCard extends StatelessWidget {
  const _AttentionCard({
    required this.label,
    required this.count,
    required this.exact,
    required this.color,
    required this.onTap,
  });

  final String label;
  final int count;

  /// False when the figure is a lower bound — the analytics range only counts
  /// what it can see, so the card says "at least".
  final bool exact;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return HelixCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          HelixText('$count', style: TypeScale.mono(color, size: 28)),
          const SizedBox(height: AppSpace.s1),
          HelixText(label, style: TypeScale.caption(AppColors.textSecondary)),
          if (!exact)
            HelixText(strings.t('admin.atLeast'), style: TypeScale.caption(AppColors.textTertiary)),
        ],
      ),
    );
  }
}
