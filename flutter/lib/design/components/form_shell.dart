import 'package:flutter/material.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

/// Wraps every tab form. On success the body remounts (remount key) so a form
/// cannot double-submit, and a queued/sent banner reports the outcome —
/// including anomalies flagged beside a SUCCESSFUL save.
///
/// The remount only rebuilds the subtree; state the parent owns (its text
/// controllers, its selected gauge, its captured photo) lives above this
/// widget. Pass [onReset] so the parent can clear its own state — otherwise a
/// successful submit leaves the form filled in and the button live again.
class FormShell extends StatefulWidget {
  const FormShell({super.key, required this.child, this.onReset});

  final Widget child;
  final VoidCallback? onReset;

  @override
  State<FormShell> createState() => FormShellState();
}

class FormShellState extends State<FormShell> {
  int _remountKey = 0;
  String? _banner;
  bool _isError = false;
  List<String> _signals = const [];

  void showQueued({List<String> signals = const []}) {
    final strings = Strings.of(context);
    setState(() {
      _banner = strings.t('forms.queued');
      _isError = false;
      _signals = signals;
      _remountKey++;
    });
    widget.onReset?.call();
  }

  void showSent({List<String> signals = const []}) {
    final strings = Strings.of(context);
    setState(() {
      _banner = strings.t('forms.sent');
      _isError = false;
      _signals = signals;
      _remountKey++;
    });
    widget.onReset?.call();
  }

  void showError(String message) {
    setState(() {
      _banner = message;
      _isError = true;
      _signals = const [];
    });
  }

  void clearBanner() {
    setState(() {
      _banner = null;
      _isError = false;
      _signals = const [];
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_banner != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpace.s4),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: 1),
              duration: AppMotion.durFade,
              curve: AppMotion.easeOut,
              builder: (context, t, child) => Opacity(
                opacity: t,
                child: Transform.translate(
                  offset: Offset(0, (1 - t) * AppSpace.s2),
                  child: child,
                ),
              ),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpace.s4),
                decoration: BoxDecoration(
                  color: _isError ? AppColors.surfaceSunk : AppColors.accentQuiet,
                  borderRadius: BorderRadius.circular(AppRadius.card),
                  border: Border.all(
                    color: _isError ? AppColors.statusDanger : AppColors.line,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HelixText(
                      _banner!,
                      style: TypeScale.bodyStrong(
                        _isError ? AppColors.statusDanger : AppColors.text,
                      ),
                    ),
                    for (final signal in _signals)
                      Padding(
                        padding: const EdgeInsets.only(top: AppSpace.s1),
                        child: HelixText(
                          signal,
                          style: TypeScale.caption(AppColors.textSecondary),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        KeyedSubtree(
          key: ValueKey(_remountKey),
          child: widget.child,
        ),
      ],
    );
  }
}
