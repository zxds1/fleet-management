import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

/// Hold-to-confirm gesture engine (Mayday, destructive confirms). The fill
/// overlay is the commitment; reduced-motion and switch-access users get the
/// same result via a labelled two-step confirm.
///
/// The hold starts on touch-down, not on the long-press timeout, so the
/// advertised duration is the duration the user actually holds. Screen-reader
/// users get an explicit semantic action, because a long-press gesture is not
/// reachable with a screen reader.
class HoldToConfirm extends StatefulWidget {
  const HoldToConfirm({
    super.key,
    required this.label,
    required this.onConfirmed,
    required this.hold,
    this.holdingLabel,
    this.reducedMotion = false,
    this.fillColor,
    this.textColor,
    this.height = AppTarget.touchPhone + 8,
  });

  final String label;
  final VoidCallback onConfirmed;
  final Duration hold;
  final String? holdingLabel;
  final bool reducedMotion;
  final Color? fillColor;
  final Color? textColor;
  final double height;

  @override
  State<HoldToConfirm> createState() => _HoldToConfirmState();
}

class _HoldToConfirmState extends State<HoldToConfirm> {
  Timer? _timer;
  double _progress = 0;
  bool _holding = false;
  bool _armed = false;

  Color get _fill => widget.fillColor ?? AppColors.statusDanger;
  Color get _onFill => widget.textColor ?? AppColors.textInverse;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _start() {
    if (_holding) return;
    setState(() {
      _holding = true;
      _progress = 0;
    });
    const steps = 50;
    final stepDuration = Duration(milliseconds: widget.hold.inMilliseconds ~/ steps);
    _timer = Timer.periodic(stepDuration, (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _progress += 1 / steps);
      if (_progress >= 1) {
        timer.cancel();
        _commit();
      }
    });
  }

  void _cancel() {
    _timer?.cancel();
    if (!_holding) return;
    setState(() {
      _holding = false;
      _progress = 0;
    });
    HapticFeedback.selectionClick();
  }

  Future<void> _commit() async {
    _timer?.cancel();
    setState(() {
      _holding = false;
      _progress = 1;
    });
    await HapticFeedback.vibrate();
    widget.onConfirmed();
    if (mounted) setState(() => _progress = 0);
  }

  @override
  Widget build(BuildContext context) {
    final strings = Strings.of(context);
    if (widget.reducedMotion) {
      return _buildTwoStep(strings);
    }
    return Semantics(
      button: true,
      label: widget.label,
      hint: strings.t('actions.holdFor', {'seconds': '${widget.hold.inSeconds}'}),
      onTap: () {
        _armed = true;
        _commit();
      },
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _start(),
        onTapUp: (_) => _cancel(),
        onTapCancel: _cancel,
        child: Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: AppColors.surfaceSunk,
            borderRadius: BorderRadius.circular(AppRadius.control),
            border: Border.all(color: _fill),
          ),
          child: Stack(
            children: [
              FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: _progress.clamp(0.0, 1.0),
                child: Container(
                  decoration: BoxDecoration(
                    color: _fill,
                    borderRadius: BorderRadius.circular(AppRadius.control),
                  ),
                ),
              ),
              Center(
                child: HelixText(
                  _holding ? (widget.holdingLabel ?? strings.t('actions.keepHolding')) : widget.label,
                  style: TypeScale.button(
                    _progress > 0.5 ? _onFill : _fill,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Non-gesture fallback: tap arms, second tap confirms.
  Widget _buildTwoStep(Strings strings) {
    return Semantics(
      button: true,
      label: _armed ? strings.t('actions.tapAgainToConfirm') : widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          if (_armed) {
            setState(() => _armed = false);
            widget.onConfirmed();
          } else {
            setState(() => _armed = true);
          }
        },
        child: Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: _armed ? _fill : AppColors.surfaceSunk,
            borderRadius: BorderRadius.circular(AppRadius.control),
            border: Border.all(color: _fill),
          ),
          alignment: Alignment.center,
          child: HelixText(
            _armed ? strings.t('actions.tapAgainToConfirm') : widget.label,
            style: TypeScale.button(_armed ? _onFill : _fill),
          ),
        ),
      ),
    );
  }
}
