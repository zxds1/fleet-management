import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/providers.dart';
import '../../design/components/buttons.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Device integrity block: reason copy + a sign-out the driver chooses. The
/// reason must stay readable — signing out on mount hides it.
class BlockedScreen extends ConsumerWidget {
  const BlockedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    final reason = ref.read(sessionProvider).securityReason;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.s5),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HelixText(strings.t('security.blockedTitle'), style: TypeScale.title(AppColors.statusDanger)),
              const SizedBox(height: AppSpace.s3),
              HelixText(
                switch (reason) {
                  'rooted' => strings.t('security.rooted'),
                  'hooked' => strings.t('security.hooked'),
                  'pinningMissing' => strings.t('security.pinningMissing'),
                  _ => strings.t('security.blockedBody'),
                },
                style: TypeScale.body(AppColors.text),
              ),
              const SizedBox(height: AppSpace.s5),
              QuietButton(
                label: strings.t('auth.logOut'),
                onPressed: () => ref.read(sessionProvider).signOut(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
