import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/providers.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/hold_to_confirm.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Driver detail: devices (revoke each, two-tap), revoke all sessions,
/// suspend/reinstate (two-tap), read-only MFA state.
class DriverDetailScreen extends ConsumerStatefulWidget {
  const DriverDetailScreen({super.key, required this.userId});

  final String userId;

  @override
  ConsumerState<DriverDetailScreen> createState() => _DriverDetailScreenState();
}

class _DriverDetailScreenState extends ConsumerState<DriverDetailScreen> {
  String get userId => widget.userId;

  Future<void> _revokeDevice(BuildContext context, String deviceId) async {
    try {
      await ref.read(repositoryProvider).revokeDevice(deviceId);
      if (context.mounted) ref.invalidate(_driverProvider(userId));
    } on HelixError catch (e) {
      if (context.mounted) showHelixError(context, e);
    }
  }

  Future<void> _status(BuildContext context, bool suspend) async {
    final repo = ref.read(repositoryProvider);
    try {
      if (suspend) {
        await repo.userAction('admin/users/:id/suspend', userId);
      } else {
        await repo.userAction('admin/users/:id/reinstate', userId);
      }
      if (context.mounted) ref.invalidate(_driverProvider(userId));
    } on HelixError catch (e) {
      if (context.mounted) showHelixError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final async = ref.watch(_driverProvider(userId));
    final canManage = ref.watch(sessionProvider).permissions.contains('user:manage');
    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('drivers.title'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: Screen(
        refresh: () async => ref.invalidate(_driverProvider(userId)),
        child: async.when(
          loading: () => const LoadingBody(),
          error: (e, _) => inlineError(context, e),
          data: (row) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HelixText(row['full_name']?.toString() ?? '', style: TypeScale.title(AppColors.text)),
              const SizedBox(height: AppSpace.s2),
              // A chip row wraps: two labels can be wider than a phone.
              Wrap(
                spacing: AppSpace.s2,
                runSpacing: AppSpace.s2,
                children: [
                  HelixChip(
                    label: strings.t('drivers.${row['status']?.toString().toLowerCase() ?? 'active'}'),
                    color: row['status'] == 'SUSPENDED' ? AppColors.statusDanger : AppColors.statusOk,
                  ),
                  HelixChip(
                    label: row['mfa_enrolled'] == true ? strings.t('drivers.mfa') : strings.t('drivers.noMfa'),
                    color: AppColors.statusNeutral,
                  ),
                ],
              ),
              const SizedBox(height: AppSpace.s4),
              HelixCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HelixText(strings.t('drivers.devices'), style: TypeScale.lead(AppColors.text)),
                    const SizedBox(height: AppSpace.s2),
                    for (final device in (row['devices'] as List? ?? const []).cast<Map<String, dynamic>>())
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpace.s2),
                        child: Row(
                          children: [
                            Expanded(
                              child: HelixText(
                                '${device['platform'] ?? '?'} · ${Fmt.dateTime(DateTime.tryParse(device['last_seen_at']?.toString() ?? ''))}',
                                style: TypeScale.caption(AppColors.textSecondary),
                              ),
                            ),
                            QuietButton(
                              fillWidth: false,
                              label: strings.t('drivers.revokeDevice'),
                              onPressed: () => _revokeDevice(context, device['device_id'].toString()),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpace.s4),
              if (canManage) ...[
                QuietButton(
                  label: strings.t('drivers.revokeSessions'),
                  onPressed: () async {
                    try {
                      await ref.read(repositoryProvider).revokeSessions(userId: userId);
                    } on HelixError catch (e) {
                      if (context.mounted) showHelixError(context, e);
                    }
                  },
                ),
                const SizedBox(height: AppSpace.s3),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: HoldToConfirm(
                    label: row['status'] == 'SUSPENDED' ? strings.t('drivers.reinstate') : strings.t('drivers.suspend'),
                    onConfirmed: () => _status(context, row['status'] != 'SUSPENDED'),
                    hold: const Duration(seconds: 2),
                    reducedMotion: MediaQuery.of(context).disableAnimations,
                    fillColor: AppColors.statusDanger,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

final _driverProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.watch(repositoryProvider).driverDetail(id);
});
