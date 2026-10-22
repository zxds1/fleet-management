import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/container.dart';
import '../../app/providers.dart';
import '../../core/offline/queue_store.dart';
import '../../design/components/buttons.dart';
import '../../design/components/card.dart';
import '../../design/components/hold_to_confirm.dart';
import '../../design/components/screen.dart';
import '../../design/components/swipe_row.dart';
import '../../design/components/text.dart';
import '../../design/components/status_badge.dart';
import '../../design/components/states.dart';
import '../../design/tokens.dart';
import '../../data/providers.dart';
import '../common.dart';

/// The outbox: every queued write with its exact state. Retry (same key),
/// edit (new key), discard (hold to confirm), and a manual "Send now".
class OutboxScreen extends ConsumerStatefulWidget {
  const OutboxScreen({super.key});

  @override
  ConsumerState<OutboxScreen> createState() => _OutboxScreenState();
}

class _OutboxScreenState extends ConsumerState<OutboxScreen> {
  List<QueueItem> _items = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final items = await ref.read(containerProvider).queue.items();
    if (!mounted) return;
    setState(() {
      _items = items;
      _loading = false;
    });
    final open = items.where((i) => i.status == QueueStatus.pending || i.status == QueueStatus.failedReview).length;
    ref.read(badgeCountsProvider.notifier).setOutbox(open);
    ref.invalidate(outboxCountProvider);
  }

  Future<void> _sendNow() async {
    ref.read(containerProvider).scheduler.kick();
    await _load();
  }

  Future<void> _retryItem(QueueItem item) async {
    await ref.read(containerProvider).queue.retry(item.id!);
    await ref.read(containerProvider).queue.drain();
    await _load();
  }

  Future<void> _discardItem(QueueItem item) async {
    await ref.read(containerProvider).queue.discard(item.id!);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('outbox.title'), style: TypeScale.title(AppColors.text))),
      body: Screen(
        refresh: _load,
        offlineCopy: true,
        child: _loading
            ? const LoadingBody()
            : _items.isEmpty
                ? EmptyState(message: strings.t('state.empty'))
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      QuietButton(
                        label: strings.t('outbox.flush'),
                        icon: Icon(Icons.send_rounded, size: 20, color: AppColors.textSecondary),
                        onPressed: _sendNow,
                      ),
                      const SizedBox(height: AppSpace.s4),
                      for (final item in _items)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpace.s3),
                          child: SwipeActionRow(
                            actions: [
                              SwipeAction(
                                label: strings.t('outbox.retry'),
                                icon: Icons.repeat_rounded,
                                color: AppColors.accent,
                                onPressed: () async => await _retryItem(item),
                              ),
                              SwipeAction(
                                label: strings.t('outbox.discard'),
                                icon: Icons.delete_outline_rounded,
                                color: AppColors.statusDanger,
                                onPressed: () async => await _discardItem(item),
                              ),
                            ],
                            child: _QueueCard(
                              item: item,
                              onRetry: () async => await _retryItem(item),
                              onEdit: () async {
                                final id = item.id;
                                if (id == null) return;
                                await context.push('/driver/outbox/$id/edit');
                                await _load();
                              },
                              onDiscard: () async => await _discardItem(item),
                            ),
                          ),
                        ),
                    ],
                  ),
      ),
    );
  }
}

class _QueueCard extends StatelessWidget {
  const _QueueCard({required this.item, required this.onRetry, required this.onEdit, required this.onDiscard});

  final QueueItem item;
  final VoidCallback onRetry;
  final VoidCallback onEdit;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final color = switch (item.status) {
      QueueStatus.pending => AppColors.statusNeutral,
      QueueStatus.inflight => AppColors.statusInfo,
      QueueStatus.done => AppColors.statusOk,
      QueueStatus.discarded => AppColors.textTertiary,
      QueueStatus.failedReview => AppColors.statusWarn,
    };
    return HelixCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: HelixText(item.path, style: TypeScale.mono(AppColors.text, size: 12))),
              HelixChip(label: queueStatusName(item.status), color: color),
            ],
          ),
          if (item.lastErrorCode != null) ...[
            const SizedBox(height: AppSpace.s2),
            HelixText(item.lastErrorCode!, style: TypeScale.caption(AppColors.statusDanger)),
          ],
          const SizedBox(height: AppSpace.s2),
          HelixText(
            context.s.t('outbox.attempts', {'n': '${item.attempts}'}),
            style: TypeScale.caption(AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpace.s3),
          Row(
            children: [
              if (item.status == QueueStatus.failedReview)
                QuietButton(label: context.s.t('outbox.edit'), onPressed: onEdit),
              if (item.status == QueueStatus.failedReview) const SizedBox(width: AppSpace.s2),
              QuietButton(label: context.s.t('outbox.retry'), onPressed: onRetry),
              const Spacer(),
              SizedBox(
                width: 120,
                child: HoldToConfirm(
                  label: context.s.t('outbox.discard'),
                  onConfirmed: onDiscard,
                  hold: const Duration(seconds: 1),
                  reducedMotion: MediaQuery.disableAnimationsOf(context),
                  fillColor: AppColors.statusDanger,
                  height: 40,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}