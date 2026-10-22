import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../core/config.dart';
import '../../core/session.dart';
import '../../core/errors.dart';
import '../../data/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/field.dart';
import '../../design/components/screen.dart';
import '../../design/components/sheet_host.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Driver settings: Account / Security / Profile / Device / Data groups, the
/// language toggle, and the SHELL SWITCHER for dual-role sessions.
class DriverSettingsScreen extends ConsumerStatefulWidget {
  const DriverSettingsScreen({super.key});

  @override
  ConsumerState<DriverSettingsScreen> createState() => _DriverSettingsScreenState();
}

class _DriverSettingsScreenState extends ConsumerState<DriverSettingsScreen> {
  bool _logoutArmed = false;

  Future<void> _logout() async {
    if (!_logoutArmed) {
      setState(() => _logoutArmed = true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.s.t('settings.logoutWarn'))),
      );
      return;
    }
    await ref.read(sessionProvider).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    final session = ref.watch(sessionProvider);
    final locale = ref.watch(localeProvider);
    final hasAdmin = session.roles.any(adminRoles.contains);

    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('nav.more'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        refresh: () async {
          ref.invalidate(outboxCountProvider);
          await ref.read(sessionProvider).refreshConsentStatus();
        },
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Section(
              title: strings.t('settings.account'),
              children: [
                ListTile(
                  title: HelixText(strings.t('profileExtra.name'), style: TypeScale.caption(AppColors.textSecondary)),
                  subtitle: HelixText(session.userId ?? '—', style: TypeScale.body(AppColors.text)),
                ),
                ListTile(
                  title: HelixText(strings.t('profile.language'), style: TypeScale.body(AppColors.text)),
                  trailing: HelixText(
                    locale.languageCode == 'sw' ? 'Kiswahili' : 'English',
                    style: TypeScale.bodyStrong(AppColors.accentText),
                  ),
                  onTap: () => ref.read(localeProvider.notifier).toggle(),
                ),
                if (hasAdmin)
                  ListTile(
                    leading: Icon(Icons.swap_horiz_rounded, color: AppColors.adminAccent),
                    title: HelixText(
                      strings.t('settings.switchRole', {'role': strings.t('settings.roleADMIN')}),
                      style: TypeScale.body(AppColors.text),
                    ),
                    trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                    onTap: () async {
                      await session.persistShell('admin');
                      if (!context.mounted) return;
                      context.go('/admin/overview');
                    },
                  ),
              ],
            ),
            const SizedBox(height: AppSpace.s5),
            Section(
              title: strings.t('settings.security'),
              children: [
                ListTile(
                  title: HelixText(strings.t('profile.resetPin'), style: TypeScale.body(AppColors.text)),
                  onTap: () => _setPin(context, ref),
                ),
                ListTile(
                  title: HelixText(strings.t('profile.setupMfa'), style: TypeScale.body(AppColors.text)),
                  trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                  onTap: () => context.push('/driver/mfa-setup'),
                ),
                ListTile(
                  title: HelixText(strings.t('settings.changePassword'), style: TypeScale.body(AppColors.text)),
                  onTap: () => _changePassword(context, ref),
                ),
              ],
            ),
            const SizedBox(height: AppSpace.s5),
            Section(
              title: strings.t('settings.data'),
              children: [
                ListTile(
                  title: HelixText(strings.t('profile.openOutbox'), style: TypeScale.body(AppColors.text)),
                  trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
                  onTap: () => context.push('/driver/outbox'),
                ),
                ListTile(
                  title: HelixText(strings.t('auth.logOut'), style: TypeScale.body(AppColors.statusDanger)),
                  onTap: _logout,
                ),
                if (_logoutArmed)
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpace.s2),
                    child: HelixText(
                      strings.t('settings.logoutWarn'),
                      style: TypeScale.caption(AppColors.statusWarn),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _setPin(BuildContext context, WidgetRef ref) async {
    final strings = context.s;
    final controller = TextEditingController();
    final pin = await SheetHost.show<String>(
      context: context,
      title: strings.t('profile.resetPin'),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Field(label: strings.t('pin.title'), controller: controller, keyboardType: TextInputType.number),
            const SizedBox(height: AppSpace.s4),
            Builder(
              builder: (sheetContext) => StrandButton(
                label: strings.t('actions.save'),
                shell: Shell.driver,
                onPressed: () {
                  final value = controller.text.trim();
                  if (value.length != 4) return;
                  Navigator.of(sheetContext).pop(value);
                },
              ),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (pin == null || pin.length != 4) return;
    await ref.read(sessionProvider).setPin(pin);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(strings.t('profile.pinSaved'))));
  }

  Future<void> _changePassword(BuildContext context, WidgetRef ref) async {
    final strings = context.s;
    final current = TextEditingController();
    final next = TextEditingController();
    await SheetHost.show(
      context: context,
      title: strings.t('settings.changePassword'),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s5),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Field(label: strings.t('auth.password'), controller: current, obscureText: true),
            const SizedBox(height: AppSpace.s4),
            Field(label: strings.t('settings.newPassword'), controller: next, obscureText: true),
            const SizedBox(height: AppSpace.s4),
            Builder(
              builder: (sheetContext) => StrandButton(
                label: strings.t('actions.save'),
                shell: Shell.driver,
                onPressed: () async {
                  try {
                    await ref.read(repositoryProvider).changePassword(current.text, next.text);
                    if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                  } on HelixError catch (e) {
                    if (context.mounted) showHelixError(context, e);
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
    current.dispose();
    next.dispose();
  }
}

/// Consent reference shown in the Device group.
final consentVersionRef = Config.consentVersion;
