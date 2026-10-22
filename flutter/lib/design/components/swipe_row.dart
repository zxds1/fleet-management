import 'package:flutter/material.dart';
import '../tokens.dart';
import '../motion.dart';
import 'text.dart';

/// One swipe action exposed when a row is dragged. Every action also has a
/// visible tap fallback — the trailing button on the row itself — so a
/// gesture never hides the only path to an action.
class SwipeAction {
  const SwipeAction({
    required this.label,
    required this.icon,
    this.color,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color? color;
  final VoidCallback onPressed;
}

/// Row that reveals trailing actions when dragged; the same actions stay
/// reachable by tapping the trailing button. Gesture-tracking is 1:1 with
/// velocity handoff to a spring on release (apple-design §3–5).
class SwipeActionRow extends StatefulWidget {
  const SwipeActionRow({
    super.key,
    required this.child,
    required this.actions,
    this.threshold = 0.45,
  });

  final Widget child;
  final List<SwipeAction> actions;
  final double threshold;

  @override
  State<SwipeActionRow> createState() => _SwipeActionRowState();
}

class _SwipeActionRowState extends State<SwipeActionRow> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this)..value = 0.0;
  double _dragStartValue = 0;
  double _dragStartX = 0;

  double get _actionsWidth => AppTarget.swipeAction * widget.actions.length;

  void _onDragStart(DragStartDetails details) {
    _dragStartValue = _controller.value;
    _dragStartX = details.globalPosition.dx;
    _controller.stop();
  }

  void _onDragUpdate(DragUpdateDetails details) {
    final delta = details.globalPosition.dx - _dragStartX; // negative = drag left reveals
    final width = _actionsWidth;
    if (width == 0) return;
    _controller.value = (_dragStartValue - delta / width).clamp(0.0, 1.0);
  }

  void _onDragEnd(DragEndDetails details) {
    final velocity = details.primaryVelocity ?? 0;
    final target = _controller.value > widget.threshold || velocity < -400 ? 1.0 : 0.0;
    springTo(
      _controller,
      target,
      description: AppSpring.ui(),
      // The value runs opposite to the pixel axis, so the handoff inverts.
      velocity: gestureVelocityToValue(velocity, _actionsWidth),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.actions.isEmpty) return widget.child;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        GestureDetector(
          onHorizontalDragStart: _onDragStart,
          onHorizontalDragUpdate: _onDragUpdate,
          onHorizontalDragEnd: _onDragEnd,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final offset = -_actionsWidth * _controller.value;
              return Transform.translate(
                offset: Offset(offset, 0),
                child: Container(
                  width: double.infinity,
                  color: AppColors.surface,
                  child: widget.child,
                ),
              );
            },
          ),
        ),
        Positioned(
          right: -_actionsWidth * (1.0 - _controller.value),
          top: 0,
          bottom: 0,
          width: _actionsWidth,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final action in widget.actions)
                Container(
                  width: AppTarget.swipeAction,
                  color: action.color ?? AppColors.accentQuiet,
                  alignment: Alignment.center,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        action.icon,
                        size: 20,
                        color: action.color ?? AppColors.accentText,
                      ),
                      const SizedBox(height: AppSpace.s1),
                      HelixText(
                        action.label,
                        style: TypeScale.caption(action.color ?? AppColors.accentText),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
