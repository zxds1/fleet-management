import 'dart:async';

import 'package:flutter/material.dart';
import '../tokens.dart';
import 'buttons.dart';
import 'text.dart';

/// Error state: the catalogue message and EXACTLY ONE action button.
/// RATE_LIMITED shows a live countdown before the retry unlocks.
class ErrorState extends StatefulWidget {
  const ErrorState({
    super.key,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.detail,
    this.waitSeconds,
  });

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? detail;
  final int? waitSeconds;

  @override
  State<ErrorState> createState() => _ErrorState();
}

class _ErrorState extends State<ErrorState> {
  Timer? _timer;
  late int _remaining = widget.waitSeconds ?? 0;

  @override
  void initState() {
    super.initState();
    if (_remaining > 0) {
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return;
        setState(() => _remaining -= 1);
        if (_remaining <= 0) timer.cancel();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final waiting = _remaining > 0;
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(
            liveRegion: true,
            child: HelixText(
              widget.message,
              style: TypeScale.body(AppColors.text),
              textAlign: TextAlign.center,
            ),
          ),
          if (widget.detail != null) ...[
            const SizedBox(height: AppSpace.s2),
            HelixText(
              widget.detail!,
              style: TypeScale.caption(AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
          ],
          if (widget.actionLabel != null) ...[
            const SizedBox(height: AppSpace.s4),
            if (waiting)
              QuietButton(label: '${widget.actionLabel} ($_remaining s)', onPressed: null)
            else
              QuietButton(label: widget.actionLabel!, onPressed: widget.onAction),
          ],
        ],
      ),
    );
  }
}

/// Empty state: what this view is for + the one next action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.message, this.actionLabel, this.onAction});

  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpace.s5),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          HelixText(
            message,
            style: TypeScale.body(AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          if (actionLabel != null) ...[
            const SizedBox(height: AppSpace.s4),
            QuietButton(label: actionLabel!, onPressed: onAction),
          ],
        ],
      ),
    );
  }
}
