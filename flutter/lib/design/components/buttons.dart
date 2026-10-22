import 'package:flutter/material.dart';
import '../tokens.dart';
import 'text.dart';

/// Button family: [StrandButton] primary (active shell strand fill),
/// [QuietButton] secondary, [DangerButton] destructive. Full state set:
/// default / pressed / focused / disabled / busy. No hand-rolled variants.
///
/// Every button is keyboard reachable (tab to it, Enter or Space to activate),
/// and the focus ring appears only for keyboard/programmatic focus — a mouse
/// press never flashes it. The pressed state is carried by a transform
/// (scale), not by animating the fill.
class StrandButton extends StatelessWidget {
  const StrandButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.shell = Shell.driver,
    this.busy = false,
    this.icon,
    this.fillWidth = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final Shell shell;
  final bool busy;
  final Widget? icon;

  /// A primary call to action fills the width it is given. A secondary button
  /// in a pair of actions sizes to its label instead.
  final bool fillWidth;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return _ButtonShell(
      label: label,
      icon: icon,
      enabled: enabled,
      busy: busy,
      height: AppTarget.touchPhone,
      fill: shell.fill,
      pressedFill: shell.pressed,
      labelColor: shell.onFill,
      disabledFill: AppColors.surfaceSunk,
      disabledLabelColor: AppColors.textTertiary,
      focusColor: shell.fill,
      fillWidth: fillWidth,
      onPressed: onPressed,
    );
  }
}

class QuietButton extends StatelessWidget {
  const QuietButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.fillWidth = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final Widget? icon;
  final bool busy;

  /// A secondary button in a pair of actions sizes to its label; a standalone
  /// one fills the width it is given.
  final bool fillWidth;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return _ButtonShell(
      label: label,
      icon: icon,
      enabled: enabled,
      busy: busy,
      height: AppTarget.touchPhone,
      fill: AppColors.surface,
      pressedFill: AppColors.surfaceSunk,
      labelColor: AppColors.text,
      disabledFill: AppColors.surfaceSunk,
      disabledLabelColor: AppColors.textTertiary,
      focusColor: AppColors.accent,
      outlined: true,
      fillWidth: fillWidth,
      onPressed: onPressed,
    );
  }
}

class DangerButton extends StatelessWidget {
  const DangerButton({super.key, required this.label, required this.onPressed, this.busy = false});

  final String label;
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    return _ButtonShell(
      label: label,
      icon: null,
      enabled: enabled,
      busy: busy,
      height: AppTarget.touchPhone,
      fill: AppColors.statusDanger,
      pressedFill: AppColors.statusDanger,
      labelColor: AppColors.textInverse,
      disabledFill: AppColors.surfaceSunk,
      disabledLabelColor: AppColors.textTertiary,
      focusColor: AppColors.statusDanger,
      onPressed: onPressed,
    );
  }
}

class _ButtonShell extends StatefulWidget {
  const _ButtonShell({
    required this.label,
    required this.icon,
    required this.enabled,
    required this.busy,
    required this.height,
    required this.fill,
    required this.pressedFill,
    required this.labelColor,
    required this.disabledFill,
    required this.disabledLabelColor,
    required this.focusColor,
    required this.onPressed,
    this.outlined = false,
    this.fillWidth = true,
  });

  final String label;
  final Widget? icon;
  final bool enabled;
  final bool busy;
  final double height;
  final Color fill;
  final Color pressedFill;
  final Color labelColor;
  final Color disabledFill;
  final Color disabledLabelColor;
  final Color focusColor;
  final VoidCallback? onPressed;
  final bool outlined;
  final bool fillWidth;

  @override
  State<_ButtonShell> createState() => _ButtonShellState();
}

class _ButtonShellState extends State<_ButtonShell> {
  bool _pressed = false;
  bool _focused = false;
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocusChanged);
  }

  void _onFocusChanged() {
    if (_focus.hasFocus != _focused) setState(() => _focused = _focus.hasFocus);
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocusChanged);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.control);
    final background = !widget.enabled
        ? widget.disabledFill
        : _pressed
            ? widget.pressedFill
            : widget.fill;
    final foreground = widget.enabled ? widget.labelColor : widget.disabledLabelColor;

    return Semantics(
      button: true,
      enabled: widget.enabled,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          focusNode: _focus,
          onTap: widget.enabled ? widget.onPressed : null,
          onTapDown: widget.enabled ? (_) => setState(() => _pressed = true) : null,
          onTapUp: widget.enabled ? (_) => setState(() => _pressed = false) : null,
          onTapCancel: widget.enabled ? () => setState(() => _pressed = false) : null,
          borderRadius: radius,
          splashColor: widget.focusColor.withValues(alpha: 0.14),
          highlightColor: Colors.transparent,
          child: Builder(
            builder: (context) {
              // The ring appears for keyboard/programmatic focus only — a
              // mouse press must not flash it.
              final showRing = _focused &&
                  FocusManager.instance.highlightMode == FocusHighlightMode.traditional;
              return AnimatedScale(
                scale: _pressed ? AppMotion.pressScale : 1.0,
                duration: AppMotion.durPress,
                curve: AppMotion.easeOut,
                child: Stack(
                  children: [
                    Container(
                      height: widget.height,
                      width: widget.fillWidth ? double.infinity : null,
                      padding: const EdgeInsets.symmetric(horizontal: AppSpace.s5),
                      decoration: BoxDecoration(
                        color: background,
                        borderRadius: radius,
                        border: widget.outlined ? Border.all(color: AppColors.line) : null,
                      ),
                      alignment: Alignment.center,
                      child: widget.busy
                          ? SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: widget.enabled ? widget.labelColor : AppColors.textTertiary,
                              ),
                            )
                          : Row(
                              // A min-size row hands its children an unbounded
                              // width, so a flex child in one can never
                              // ellipsise. The label is flexible only when the
                              // button itself has a bounded width.
                              mainAxisSize:
                                  widget.fillWidth ? MainAxisSize.max : MainAxisSize.min,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                if (widget.icon != null) ...[
                                  widget.icon!,
                                  const SizedBox(width: AppSpace.s2),
                                ],
                                if (widget.fillWidth)
                                  Flexible(
                                    child: HelixText.chrome(
                                      widget.label,
                                      style: TypeScale.button(foreground),
                                      maxLines: 1,
                                      textAlign: TextAlign.center,
                                    ),
                                  )
                                else
                                  HelixText.chrome(
                                    widget.label,
                                    style: TypeScale.button(foreground),
                                    maxLines: 1,
                                    textAlign: TextAlign.center,
                                  ),
                              ],
                            ),
                    ),
                    if (showRing)
                      Positioned.fill(
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              borderRadius: radius,
                              border: Border.all(color: widget.focusColor, width: 2),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
