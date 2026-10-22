import 'package:flutter/material.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';

/// Pulsing skeleton bars. Honours reduced-motion (static). Announced once.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.lines = 1});

  final double height;
  final double? width;
  final int lines;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  bool _reduce = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduce = MediaQuery.disableAnimationsOf(context);
    if (_reduce) {
      _controller.stop();
      _controller.value = 0;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: Strings.of(context).t('state.loading'),
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = 0.5 + 0.5 * _controller.value;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < widget.lines; i++) ...[
                if (i > 0) const SizedBox(height: AppSpace.s2),
                Container(
                  height: widget.height,
                  width: widget.width ?? double.infinity,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSunk,
                    borderRadius: BorderRadius.circular(AppRadius.control - 4),
                  ),
                  child: Opacity(
                    // A shimmer is an opacity sweep, not a colour change.
                    opacity: _reduce ? 0 : 0.10 + 0.35 * t,
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(AppRadius.control - 4),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
