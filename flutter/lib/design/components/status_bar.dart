import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/container.dart';
import '../../core/policy.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'text.dart';

/// The queue's state, as the UI needs it.
class SyncState {
  const SyncState({this.pending = 0, this.failed = 0, this.online = true, this.sending = false});

  final int pending;
  final int failed;
  final bool online;
  final bool sending;

  bool get isQuiet => pending == 0 && failed == 0 && !sending;
}

/// The honest state of the offline queue, polled from the store.
///
/// This is an offline-first product: a driver needs to know, at a glance,
/// whether the work they have done has actually left the device. The status
/// bar answers that without a modal, a spinner, or a toast.
final syncStateProvider = StreamProvider<SyncState>((ref) async* {
  final container = ref.watch(containerProvider);
  ref.onDispose(() {});

  Future<SyncState> read() async {
    final counts = await container.queue.statusCounts();
    return SyncState(
      pending: counts.pending,
      failed: counts.failed,
      online: container.connectivity.isOnline,
    );
  }

  yield await read();

  // Two independent sources: a completed drain changes the counts at once,
  // and the queue also changes locally (a new write, an edit, a discard),
  // which no drain reports.
  final controller = StreamController<SyncState>();
  ref.onDispose(controller.close);
  unawaited(() async {
    await for (final _ in container.drained) {
      controller.add(await read());
    }
  }());
  unawaited(() async {
    await for (final _ in Stream.periodic(Policy.queuePollInterval, (_) => null)) {
      controller.add(await read());
    }
  }());
  yield* controller.stream;
});

/// A thin status bar for the top of a shell: what the queue is doing, and
/// what is waiting. It is deliberately quiet — it appears when there is
/// something to say and disappears when there is not.
class SyncStatusBar extends ConsumerWidget {
  const SyncStatusBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncStateProvider).valueOrNull;
    if (sync == null || sync.isQuiet) return const SizedBox.shrink();
    final strings = Strings.of(context);

    final (String message, Color tone) = switch (sync) {
      _ when sync.failed > 0 => (
          strings.t('sync.failed', {'n': '${sync.failed}'}),
          AppColors.statusDanger
        ),
      _ when !sync.online && sync.pending > 0 => (
          strings.t('sync.waiting', {'n': '${sync.pending}'}),
          AppColors.statusWarn
        ),
      _ when sync.pending > 0 => (
          strings.t('sync.sending', {'n': '${sync.pending}'}),
          AppColors.accentText
        ),
      _ => ('', AppColors.textSecondary),
    };
    if (message.isEmpty) return const SizedBox.shrink();

    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        color: AppColors.surfaceSunk,
        padding: const EdgeInsets.fromLTRB(AppSpace.s4, AppSpace.s2, AppSpace.s4, AppSpace.s2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (sync.sending)
                  SizedBox(
                    height: 12,
                    width: 12,
                    child: CircularProgressIndicator(strokeWidth: 2, color: tone),
                  )
                else
                  Icon(
                    sync.online ? Icons.cloud_upload_rounded : Icons.cloud_off_rounded,
                    size: 16,
                    color: tone,
                  ),
                const SizedBox(width: AppSpace.s2),
                Expanded(
                  child: HelixText(
                    message,
                    style: TypeScale.caption(tone),
                    maxLines: 1,
                  ),
                ),
              ],
            ),
            if (sync.pending > 0) ...[
              const SizedBox(height: AppSpace.s2),
              // The progress line: how much of the queue is still to go.
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.full),
                child: LinearProgressIndicator(
                  minHeight: 3,
                  value: sync.sending ? null : 0,
                  backgroundColor: AppColors.line,
                  valueColor: AlwaysStoppedAnimation(tone),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
