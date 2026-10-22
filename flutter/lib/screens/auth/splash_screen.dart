import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../design/components/helix_logo.dart';
import '../../design/components/privacy_shield.dart';
import '../../design/tokens.dart';
import '../../design/components/text.dart';
import '../../i18n/strings.dart';

/// Boot screen: logo tile on bone, silent restore — no spinner theatre.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PrivacyShield(
      child: ColoredBox(
        color: AppColors.bg,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              HelixLogo(size: 96),
              SizedBox(height: AppSpace.s5),
              HelixText(
                Strings.of(context).t('auth.splashHint'),
                style: TypeScale.caption(AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
