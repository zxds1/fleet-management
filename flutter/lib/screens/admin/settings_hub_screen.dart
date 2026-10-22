import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../design/components/card.dart';
import '../../design/components/screen.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Admin More hub: the sub-screens, the shell switcher back to the driver
/// experience, and sign-out.
class AdminSettingsHubScreen extends ConsumerWidget {
  const AdminSettingsHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final session = ref.watch(sessionProvider);
    final hasDriver = session.roles.contains('DRIVER');
    final hasFuel = session.permissions.contains('fuel:read');
    final hasUsers = session.permissions.contains('user:read');
    final hasAssets = session.permissions.contains('asset:read');
    final hasTraining = session.permissions.contains('training:read');
    final hasMaintenance = session.permissions.contains('maintenance:read');

    final entries = <(String, String, bool)>[
      (strings.t('admin.accidents'), '/admin/accidents', true),
      (strings.t('tabs.review'), '/admin/review', true),
      (strings.t('review.fuel'), '/admin/fuel-pending', hasFuel),
      (strings.t('importer.title'), '/admin/import-statement', session.permissions.contains('fuel:reconcile')),
      (strings.t('drivers.title'), '/admin/drivers', hasUsers),
      (strings.t('vehicle.title'), '/admin/vehicles', hasAssets),
      (strings.t('hardware.title'), '/admin/tracker-pair', hasAssets),
      (strings.t('training.title'), '/admin/training', hasTraining),
      (strings.t('maintenance.title'), '/admin/maintenance', hasMaintenance),
      (strings.t('privacy.title'), '/admin/privacy', true),
      (strings.t('inbox.title'), '/admin/inbox', true),
    ];

    return Scaffold(
      appBar: AppBar(
        title: HelixText(strings.t('nav.more'), style: TypeScale.title(AppColors.text)),
        backgroundColor: AppColors.surface,
      ),
      body: Screen(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HelixCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  HelixText(strings.t('profileExtra.name'), style: TypeScale.caption(AppColors.textSecondary)),
                  HelixText(session.userId ?? '—', style: TypeScale.body(AppColors.text)),
                  const SizedBox(height: AppSpace.s2),
                  HelixText(session.roles.join(', '), style: TypeScale.caption(AppColors.adminAccent)),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.s4),
            for (final entry in entries)
              if (entry.$3)
                ListTile(
                  trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                  title: HelixText(entry.$1, style: TypeScale.body(AppColors.text)),
                  onTap: () => context.push(entry.$2),
                ),
            Divider(height: 32, color: AppColors.line),
            if (hasDriver)
              ListTile(
                leading: Icon(Icons.swap_horiz_rounded, color: AppColors.accent),
                title: HelixText(
                  strings.t('settings.switchRole', {'role': strings.t('settings.roleDRIVER')}),
                  style: TypeScale.body(AppColors.text),
                ),
                onTap: () async {
                  await session.persistShell('driver');
                  if (!context.mounted) return;
                  context.go('/driver/home');
                },
              ),
            ListTile(
              title: HelixText(strings.t('auth.logOut'), style: TypeScale.body(AppColors.statusDanger)),
              onTap: () => ref.read(sessionProvider).signOut(),
            ),
          ],
        ),
      ),
    );
  }
}
