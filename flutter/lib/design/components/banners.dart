import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/container.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

/// 4s bottom toast, announced to screen readers.
class ToastController extends ChangeNotifier {
  String? _message;
  String? get message => _message;
  int _nonce = 0;
  int get nonce => _nonce;
  Timer? _timer;

  void show(String message) {
    _message = message;
    _nonce += 1;
    notifyListeners();
    _timer?.cancel();
    _timer = Timer(const Duration(seconds: 4), clear);
  }

  void clear() {
    _timer?.cancel();
    _timer = null;
    if (_message == null) return;
    _message = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}

final toastProvider = ChangeNotifierProvider<ToastController>((ref) => ToastController());

class Toast extends ConsumerStatefulWidget {
  const Toast({super.key});

  @override
  ConsumerState<Toast> createState() => _ToastState();
}

class _ToastState extends ConsumerState<Toast> {
  @override
  Widget build(BuildContext context) {
    final toast = ref.watch(toastProvider);
    if (toast.message == null) return const SizedBox.shrink();
    final lift = MediaQuery.paddingOf(context).bottom + AppScale.of(false).tabBarHeight;
    return Positioned(
      left: AppSpace.s4,
      right: AppSpace.s4,
      bottom: AppSpace.s4 + lift,
      child: Semantics(
        liveRegion: true,
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
            padding: const EdgeInsets.all(AppSpace.s4),
            decoration: BoxDecoration(
              color: AppColors.surfaceInverse,
              borderRadius: BorderRadius.circular(AppRadius.control),
            ),
            child: HelixText(toast.message!, style: TypeScale.body(AppColors.textInverse)),
          ),
        ),
      ),
    );
  }
}

/// Honest offline banner — the field principle, always visible when offline.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final container = ref.watch(containerProvider);
    return StreamBuilder<bool>(
      stream: container.connectivity.changes,
      initialData: container.connectivity.isOnline,
      builder: (context, snapshot) {
        if (snapshot.data == true) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          color: AppColors.surfaceInverse,
          padding: const EdgeInsets.symmetric(vertical: AppSpace.s2, horizontal: AppSpace.s4),
          child: SafeArea(
            bottom: false,
            child: HelixText(
              Strings.of(context).t('offline.banner'),
              style: TypeScale.caption(AppColors.textInverse),
              textAlign: TextAlign.center,
            ),
          ),
        );
      },
    );
  }
}
