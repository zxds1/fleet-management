import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/providers.dart';
import '../../core/policy.dart';
import '../../core/session.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Offline PIN unlock. 4 digits, big keys; lock after 5 wrong (15 min), wipe
/// after 10 (forces a password login). Counts come from policy thresholds.
class PinScreen extends ConsumerStatefulWidget {
  const PinScreen({super.key});

  @override
  ConsumerState<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends ConsumerState<PinScreen> {
  final _pin = <String>[];
  String? _announcement;

  void _press(String digit) {
    setState(() {
      if (_pin.length < 4) _pin.add(digit);
      _announcement = null;
    });
    if (_pin.length == 4) _verify();
  }

  Future<void> _verify() async {
    final strings = context.s;
    final session = ref.read(sessionProvider);
    final result = await session.verifyPin(_pin.join());
    if (!mounted) return;
    switch (result.outcome) {
      case PinOutcome.ok:
        await session.completePinUnlock();
        return;
      case PinOutcome.locked:
        setState(() {
          _pin.clear();
          _announcement = strings.t('pin.locked');
        });
        return;
      case PinOutcome.wiped:
        setState(() {
          _pin.clear();
          _announcement = strings.t('pin.wiped');
        });
        return;
      case PinOutcome.wrong:
        setState(() {
          _pin.clear();
          _announcement =
              '${strings.t('pin.wrong')} · ${strings.t('pin.attempts', {'n': '${result.remainingAttempts ?? 0}'})}';
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.s5),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              HelixText(strings.t('pin.title'), style: TypeScale.title(AppColors.text)),
              const SizedBox(height: AppSpace.s5),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < 4; i++)
                    Container(
                      width: 18,
                      height: 18,
                      margin: const EdgeInsets.symmetric(horizontal: AppSpace.s2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _pin.length > i ? AppColors.text : AppColors.surfaceSunk,
                        border: Border.all(color: AppColors.line),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: AppSpace.s4),
              Semantics(
                liveRegion: true,
                child: HelixText(
                  _announcement ?? strings.t('pin.attempts', {'n': '${Policy.pinLockoutAttempts}'}),
                  style: TypeScale.caption(
                    _announcement == null ? AppColors.textSecondary : AppColors.statusDanger,
                  ),
                ),
              ),
              const SizedBox(height: AppSpace.s5),
              for (var row = 0; row < 4; row++)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpace.s3),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var col = 0; col < 3; col++)
                        _padKey(row * 3 + col + 1),
                    ],
                  ),
                ),
              TextButton(
                onPressed: () => ref.read(sessionProvider).signOut(),
                child: HelixText(strings.t('pin.loginInstead'), style: TypeScale.body(AppColors.accentText)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _padKey(int digit) {
    if (digit == 10) return const SizedBox(width: AppSpace.s6);
    if (digit == 12) {
      return _key('⌫', () {
        if (_pin.isNotEmpty) setState(() => _pin.removeLast());
      });
    }
    return _key('$digit', () => _press('$digit'));
  }

  Widget _key(String label, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s1),
      child: SizedBox(
        width: AppTarget.touchPhone,
        height: AppTarget.touchPhone,
        child: TextButton(
          onPressed: onTap,
          style: TextButton.styleFrom(
            backgroundColor: AppColors.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.control),
              side: BorderSide(color: AppColors.line),
            ),
          ),
          child: HelixText(label, style: TypeScale.title(AppColors.text)),
        ),
      ),
    );
  }
}
