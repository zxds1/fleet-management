import 'package:flutter/material.dart';
import '../tokens.dart';
import 'chips.dart';

/// The one page container: safe areas, gutters, optional scroll + pull-to-refresh
/// and an offline tag marking cached copies.
class Screen extends StatelessWidget {
  const Screen({
    super.key,
    required this.child,
    this.padding = true,
    this.scroll = true,
    this.offlineCopy = false,
    this.refresh,
    this.bottomInset = true,
  });

  final Widget child;
  final bool padding;
  final bool scroll;
  final bool offlineCopy;
  final Future<void> Function()? refresh;
  final bool bottomInset;

  @override
  Widget build(BuildContext context) {
    // The page owns its surface: a screen must be usable on its own, not only
    // inside the shell's Scaffold. Material also gives Material widgets inside
    // it (ListTile, TextField, the ink of a ripple) the ancestor they need.
    final content = Material(
      type: MaterialType.transparency,
      child: SafeArea(
      top: false,
      bottom: bottomInset,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: padding ? AppSpace.gutterPhone : 0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (offlineCopy) ...[
              const OfflineTag(),
              const SizedBox(height: AppSpace.s3),
            ],
            Flexible(child: child),
          ],
        ),
      ),
      ),
    );
    if (!scroll) return ColoredBox(color: AppColors.bg, child: content);
    final scrollView = SingleChildScrollView(
      physics: refresh != null ? const AlwaysScrollableScrollPhysics() : null,
      padding: EdgeInsets.only(
        top: MediaQuery.paddingOf(context).top + AppSpace.s4,
        bottom: AppSpace.s6,
      ),
      child: content,
    );
    return ColoredBox(
      color: AppColors.bg,
      child: refresh == null
          ? scrollView
          : RefreshIndicator(
              onRefresh: refresh!,
              color: AppColors.accentText,
              backgroundColor: AppColors.surface,
              child: scrollView,
            ),
    );
  }
}

/// Scrollable column screen used by list-hosting screens.
class ScreenColumn extends StatelessWidget {
  const ScreenColumn({super.key, required this.children, this.offlineCopy = false});

  final List<Widget> children;
  final bool offlineCopy;

  @override
  Widget build(BuildContext context) {
    return Screen(
      scroll: true,
      offlineCopy: offlineCopy,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }
}
