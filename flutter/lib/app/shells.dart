import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../design/tokens.dart';
import '../design/theme.dart';
import '../design/components/status_bar.dart';
import '../design/components/text.dart';
import '../i18n/strings.dart';

/// One bottom-tab destination inside a shell.
class ShellTab {
  const ShellTab({
    required this.route,
    required this.icon,
    required this.activeIcon,
    required this.labelKey,
  });

  final String route;
  final IconData icon;
  final IconData activeIcon;
  final String labelKey;
}

/// The two shells. The strand colour is the shell's identity: cyan = driver,
/// violet = admin. It tints the active indicator only — never the chrome.
///
/// The admin shell re-themes Material's own components (chips, switches,
/// progress) to the violet strand, so a Material-default control inside an
/// admin screen does not render in the driver strand's colour.
class ShellScaffold extends StatelessWidget {
  const ShellScaffold({
    super.key,
    required this.shell,
    required this.tabs,
    required this.navigationShell,
  });

  final Shell shell;
  final List<ShellTab> tabs;
  final StatefulNavigationShell navigationShell;

  Color get _strand => shell == Shell.admin ? AppColors.adminAccent : AppColors.accent;

  @override
  Widget build(BuildContext context) {
    final scale = shell == Shell.admin ? AppScale.of(true) : AppScale.of(false);
    final brightness = Theme.of(context).brightness;
    final media = MediaQuery.of(context);

    Widget body = MediaQuery(
      // The tab bar floats over the content; the extra bottom inset keeps the
      // last row of a list clear of it.
      data: media.copyWith(
        padding: media.padding.copyWith(bottom: media.padding.bottom + scale.tabBarHeight),
      ),
      // The queue's status sits above the content: an offline-first product
      // has to say out loud whether the driver's work has left the device.
      child: Column(
        children: [
          const SyncStatusBar(),
          Expanded(child: navigationShell),
        ],
      ),
    );

    if (shell == Shell.admin) {
      body = Theme(
        data: HelixTheme.restyle(Theme.of(context), Shell.admin, brightness),
        child: body,
      );
    }

    return Scaffold(
      extendBody: true,
      body: body,
      bottomNavigationBar: _FrostedTabBar(
        strand: _strand,
        scale: scale,
        tabs: tabs,
        currentIndex: navigationShell.currentIndex,
        onSelect: (i) => navigationShell.goBranch(
          i,
          initialLocation: i == navigationShell.currentIndex,
        ),
      ),
    );
  }
}

/// Frosted translucent tab bar. Content scrolls underneath it; a hairline
/// separates it from the content rather than a solid block.
class _FrostedTabBar extends StatelessWidget {
  const _FrostedTabBar({
    required this.strand,
    required this.scale,
    required this.tabs,
    required this.currentIndex,
    required this.onSelect,
  });

  final Color strand;
  final AppScale scale;
  final List<ShellTab> tabs;
  final int currentIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final strings = Strings.of(context);
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: AppColors.frostChrome,
            border: Border(
              top: BorderSide(color: AppColors.line, width: 0.5),
            ),
          ),
          child: SafeArea(
            top: false,
            child: SizedBox(
              height: scale.tabBarHeight,
              child: Row(
                children: [
                  for (var i = 0; i < tabs.length; i++)
                    Expanded(
                      child: _TabButton(
                        tab: tabs[i],
                        label: strings.t(tabs[i].labelKey),
                        active: i == currentIndex,
                        strand: strand,
                        scale: scale,
                        onTap: () => onSelect(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({
    required this.tab,
    required this.label,
    required this.active,
    required this.strand,
    required this.scale,
    required this.onTap,
  });

  final ShellTab tab;
  final String label;
  final bool active;
  final Color strand;
  final AppScale scale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.text : AppColors.textSecondary;
    return Semantics(
      selected: active,
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          splashColor: strand.withValues(alpha: 0.14),
          highlightColor: Colors.transparent,
          child: SizedBox(
            height: scale.tabBarHeight,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(active ? tab.activeIcon : tab.icon, size: 22, color: color),
                const SizedBox(height: 3),
                HelixText.chrome(
                  label,
                  style: TypeScale.caption(color),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
