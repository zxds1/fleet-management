import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../tokens.dart';
import '../../i18n/strings.dart';
import 'text.dart';

/// Labelled input: label above the field, blur validation, error below,
/// visible required marker, helper text. Sunk well + perceivable outline.
///
/// The focus ring is drawn as an overlay so it never shifts the field's
/// content, and it snaps on rather than animating — focus feedback must be
/// immediate.
class Field extends StatefulWidget {
  const Field({
    super.key,
    required this.label,
    this.controller,
    this.errorText,
    this.helperText,
    this.required = false,
    this.obscureText = false,
    this.keyboardType,
    this.inputFormatters,
    this.enabled = true,
    this.maxLines = 1,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    this.textInputAction,
  });

  final String label;
  final TextEditingController? controller;
  final String? errorText;
  final String? helperText;
  final bool required;
  final bool obscureText;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final bool enabled;
  final int maxLines;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;
  final TextInputAction? textInputAction;

  @override
  State<Field> createState() => _FieldState();
}

class _FieldState extends State<Field> {
  bool _obscure = true;
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
    final hasError = widget.errorText != null;
    final strings = context.s;
    final radius = BorderRadius.circular(AppRadius.control);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The label has to be able to wrap: a long one ("Last accepted
            // odometer reading") overflowed the row on a phone.
            Flexible(
              child: HelixText(
                widget.label,
                style: TypeScale.caption(AppColors.textSecondary),
                maxLines: 2,
              ),
            ),
            if (widget.required) ...[
              const SizedBox(width: AppSpace.s1),
              Semantics(
                label: strings.t('forms.required'),
                excludeSemantics: true,
                child: HelixText(
                  '*',
                  style: TypeScale.caption(AppColors.statusDanger),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: AppSpace.s2),
        Stack(
          children: [
            Container(
              decoration: BoxDecoration(
                color: AppColors.surfaceSunk,
                borderRadius: radius,
                border: Border.all(
                  color: hasError ? AppColors.statusDanger : AppColors.lineStrong,
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: widget.controller,
                      focusNode: _focus,
                      obscureText: widget.obscureText && _obscure,
                      keyboardType: widget.keyboardType,
                      inputFormatters: widget.inputFormatters,
                      enabled: widget.enabled,
                      maxLines: widget.obscureText && _obscure ? 1 : widget.maxLines,
                      onChanged: widget.onChanged,
                      onSubmitted: widget.onSubmitted,
                      autofocus: widget.autofocus,
                      textInputAction: widget.textInputAction,
                      style: TypeScale.body(AppColors.text),
                      cursorColor: AppColors.accentText,
                      decoration: const InputDecoration(
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: AppSpace.s4,
                          vertical: AppSpace.s4,
                        ),
                        filled: false,
                      ),
                    ),
                  ),
                  if (widget.obscureText)
                    IconButton(
                      tooltip: _obscure
                          ? strings.t('auth.showPassword')
                          : strings.t('auth.hidePassword'),
                      icon: Icon(
                        _obscure ? Icons.visibility_rounded : Icons.visibility_off_rounded,
                        color: AppColors.textSecondary,
                      ),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                ],
              ),
            ),
            if (_focused)
              Positioned.fill(
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: radius,
                      border: Border.all(color: AppColors.accentText, width: 2),
                    ),
                  ),
                ),
              ),
          ],
        ),
        if (widget.helperText != null && !hasError) ...[
          const SizedBox(height: AppSpace.s1),
          HelixText(widget.helperText!, style: TypeScale.caption(AppColors.textSecondary)),
        ],
        if (hasError) ...[
          const SizedBox(height: AppSpace.s1),
          Semantics(
            liveRegion: true,
            child: HelixText(
              widget.errorText!,
              style: TypeScale.caption(AppColors.statusDanger),
            ),
          ),
        ],
      ],
    );
  }
}
