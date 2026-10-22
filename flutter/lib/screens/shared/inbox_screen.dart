import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../app/providers.dart';
import '../../core/deep_links.dart';
import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/providers.dart';
import '../../design/components/paged_list.dart';
import '../../design/components/segmented.dart';
import '../../design/components/swipe_row.dart';
import '../../design/components/text.dart';
import '../../design/tokens.dart';
import '../common.dart';

/// Marks one notification read. The row is acknowledged on the server
/// (the status becomes DELIVERED); the caller keeps the dot in step.
Future<bool> markReadSafely(WidgetRef ref, String id) async {
  try {
    await ref.read(repositoryProvider).markRead(id);
    return true;
  } on HelixError catch (e) {
    if (ref.context.mounted) showHelixError(ref.context, e);
    return false;
  }
}

/// Inbox: Notifications / Flags / Documents. Mark-read only with
/// `notification:read`; exact unread count drives the admin badge.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key, this.initial});

  final String? initial;

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  static const List<String> _segments = ['notifications', 'flags', 'docs'];
  String _segment = 'notifications';
  bool _initialised = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialised) return;
    _initialised = true;
    // The deep link carries the tab: /driver/inbox?initial=notifications
    String? fromRoute;
    try {
      fromRoute = GoRouterState.of(context).uri.queryParameters['initial'];
    } catch (_) {
      fromRoute = null; // rendered outside the router
    }
    final candidate = fromRoute ?? widget.initial;
    if (candidate != null && _segments.contains(candidate)) {
      _segment = candidate;
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return Scaffold(
      appBar: AppBar(title: HelixText(strings.t('inbox.title'), style: TypeScale.title(AppColors.text))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpace.s4),
            child: Segmented<String>(
              value: _segment,
              onChanged: (v) => setState(() => _segment = v),
              options: [
                SegmentedOption('notifications', strings.t('inbox.notifications')),
                SegmentedOption('flags', strings.t('inbox.flags')),
                SegmentedOption('docs', strings.t('inbox.docs')),
              ],
            ),
          ),
          Expanded(
            child: switch (_segment) {
              'notifications' => const _NotificationsList(),
              'flags' => const _FlagsList(),
              'docs' => const _DocsList(),
              _ => const SizedBox.shrink(),
            },
          ),
        ],
      ),
    );
  }
}

/// The statuses the backend treats as read (packages/shared/src/notifications.ts).
const Set<String> _readStatuses = {'DELIVERED', 'SUPPRESSED_DND'};

class _NotificationsList extends ConsumerStatefulWidget {
  const _NotificationsList();

  @override
  ConsumerState<_NotificationsList> createState() => _NotificationsListState();
}

class _NotificationsListState extends ConsumerState<_NotificationsList> {
  /// The rows acknowledged in this session — the server flips them to
  /// DELIVERED, and the list must show that immediately.
  final Set<String> _acknowledged = {};

  bool _isUnread(Map<String, dynamic> row) {
    final id = row['id']?.toString();
    if (id != null && _acknowledged.contains(id)) return false;
    final status = row['status']?.toString() ?? '';
    return !_readStatuses.contains(status);
  }

  Future<void> _markRead(Map<String, dynamic> row) async {
    final id = row['id']?.toString();
    if (id == null) return;
    final ok = await markReadSafely(ref, id);
    if (!ok || !mounted) return;
    setState(() => _acknowledged.add(id));
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.s;
    return PagedList<Map<String, dynamic>>(
      offlineCopy: true,
      emptyMessage: strings.t('notifications.empty'),
      loadMore: (cursor) async {
        try {
          return await ref.read(repositoryProvider).page('notifications', cursor: cursor);
        } on HelixError catch (e) {
          throw HelixErrorLike(
            strings.t(e.catalogue.i18nKey),
            actionLabel: strings.t(e.catalogue.action.labelKey),
          );
        }
      },
      itemBuilder: (context, row) {
        final unread = _isUnread(row);
        final payload = row['payload'];
        final link = targetFromNotification(payload is Map<String, dynamic> ? payload : const {});
        final canManage = ref.watch(sessionProvider).permissions.contains('notification:read');
        return SwipeActionRow(
          actions: canManage && unread
              ? [
                  SwipeAction(
                    label: strings.t('inbox.markRead'),
                    icon: Icons.mark_email_read_rounded,
                    color: AppColors.accent,
                    onPressed: () async => await _markRead(row),
                  ),
                ]
              : [],
          child: ListTile(
            leading: unread ? Icon(Icons.circle_rounded, size: 10, color: AppColors.accentText) : null,
            title: HelixText(row['title']?.toString() ?? '', style: TypeScale.bodyStrong(AppColors.text)),
            subtitle: HelixText(
              '${row['body'] ?? ''} · ${Fmt.time(Fmt.parseTimestamp(row['created_at']?.toString()))}',
              style: TypeScale.caption(AppColors.textSecondary),
            ),
            trailing: canManage && unread
                ? IconButton(
                    tooltip: strings.t('inbox.markRead'),
                    icon: Icon(Icons.mark_email_read_rounded, color: AppColors.textSecondary),
                    onPressed: () async => await _markRead(row),
                  )
                : null,
            onTap: () async {
              if (canManage) {
                await _markRead(row);
              }
              if (link != null && context.mounted) {
                context.push(routeForDeepLink(link, ref.read(sessionProvider)) ?? '/driver/inbox');
              }
            },
          ),
        );
      },
    );
  }
}

class _FlagsList extends ConsumerWidget {
  const _FlagsList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return PagedList<Map<String, dynamic>>(
      offlineCopy: true,
      emptyMessage: strings.t('anomalies.empty'),
      loadMore: (cursor) async {
        try {
          return await ref.read(repositoryProvider).page('anomalies', cursor: cursor);
        } on HelixError catch (e) {
          throw HelixErrorLike(
            strings.t(e.catalogue.i18nKey),
            actionLabel: strings.t(e.catalogue.action.labelKey),
          );
        }
      },
      itemBuilder: (context, row) => ListTile(
        title: HelixText(row['kind']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
        subtitle: HelixText(
          '${row['domain'] ?? ''} · ${row['severity'] ?? ''}',
          style: TypeScale.caption(AppColors.textSecondary),
        ),
        trailing: Icon(Icons.chevron_right_rounded, color: AppColors.textSecondary),
        onTap: () => context.push('/anomaly/${row['id']}'),
      ),
    );
  }
}

class _DocsList extends ConsumerWidget {
  const _DocsList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = context.s;
    return PagedList<Map<String, dynamic>>(
      offlineCopy: true,
      emptyMessage: strings.t('docs.empty'),
      loadMore: (cursor) async {
        try {
          return await ref
              .read(repositoryProvider)
              .page('documents/expiring', cursor: cursor, query: {'within_days': 30});
        } on HelixError catch (e) {
          throw HelixErrorLike(
            strings.t(e.catalogue.i18nKey),
            actionLabel: strings.t(e.catalogue.action.labelKey),
          );
        }
      },
      itemBuilder: (context, row) {
        final days = row['days_remaining'] as int?;
        return ListTile(
          title: HelixText(row['subject_name']?.toString() ?? '', style: TypeScale.body(AppColors.text)),
          subtitle: HelixText(row['document_type']?.toString() ?? '', style: TypeScale.caption(AppColors.textSecondary)),
          trailing: HelixText(
            days == null ? '' : days <= 0 ? strings.t('docs.expired') : strings.t('docs.days', {'n': '$days'}),
            style: TypeScale.caption(days != null && days <= 7 ? AppColors.statusDanger : AppColors.textSecondary),
          ),
          onTap: () => context.push('/document/${row['document_id']}'),
        );
      },
    );
  }
}
