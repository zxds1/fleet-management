import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../core/session.dart';
import '../../design/components/buttons.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Dual-role entry: two large cards — the two strands of the Helix.
class RoleSwitchScreen extends ConsumerWidget {
  const RoleSwitchScreen({super.key});

  Future<void> _choose(BuildContext context, WidgetRef ref, String shell) async {
    await ref.read(sessionProvider).persistShell(shell);
    if (!context.mounted) return;
    context.go(shell == 'admin' ? '/admin/overview' : '/driver/home');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final session = ref.watch(sessionProvider);
    final roles = session.roles.map((r) => r.trim().toUpperCase()).toSet();
    final isDriver = roles.contains('DRIVER');
    final isAdmin = roles.any(adminRoles.map((r) => r.toUpperCase()).contains);
    if (!isDriver && !isAdmin) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.s5),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                HelixText(strings.t('auth.chooseExperience'), style: TypeScale.title(AppColors.text)),
                const SizedBox(height: AppSpace.s4),
                HelixText(strings.t('auth.noAccess'), style: TypeScale.body(AppColors.textSecondary)),
                const Spacer(),
                StrandButton(
                  label: strings.t('auth.logOut'),
                  shell: Shell.driver,
                  onPressed: () => ref.read(sessionProvider).signOut(),
                ),
                const SizedBox(height: AppSpace.s5),
              ],
            ),
          ),
        ),
      );
    }
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.s5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HelixText(strings.t('auth.chooseExperience'), style: TypeScale.title(AppColors.text)),
              const Spacer(),
              if (isDriver)
                _StrandCard(
                  title: strings.t('auth.continueDriver'),
                  color: AppColors.accent,
                  onTap: () => _choose(context, ref, 'driver'),
                ),
              if (isAdmin)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpace.s4),
                  child: _StrandCard(
                    title: strings.t('auth.continueAdmin'),
                    color: AppColors.adminAccent,
                    onTap: () => _choose(context, ref, 'admin'),
                  ),
                ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActivateCardIntent extends Intent {
  const _ActivateCardIntent();
}

class _StrandCard extends StatelessWidget {
  const _StrandCard({required this.title, required this.color, required this.onTap});

  final String title;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: title,
      excludeSemantics: true,
      child: FocusableActionDetector(
        mouseCursor: SystemMouseCursors.click,
        shortcuts: const {
          SingleActivator(LogicalKeyboardKey.enter): _ActivateCardIntent(),
          SingleActivator(LogicalKeyboardKey.space): _ActivateCardIntent(),
        },
        actions: {
          _ActivateCardIntent: CallbackAction<_ActivateCardIntent>(
            onInvoke: (_) {
              onTap();
              return null;
            },
          ),
        },
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.card),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpace.s5),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.card),
              border: Border.all(color: AppColors.line, width: 2),
            ),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 48,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                  ),
                ),
                const SizedBox(width: AppSpace.s4),
                Expanded(child: HelixText(title, style: TypeScale.lead(AppColors.text))),
                Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
