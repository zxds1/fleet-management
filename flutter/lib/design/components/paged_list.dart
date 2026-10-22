import 'package:flutter/material.dart';
import '../../core/errors.dart';
import '../../core/policy.dart';
import '../../i18n/strings.dart';
import '../tokens.dart';
import 'buttons.dart';
import 'chips.dart';
import 'states.dart';
import 'skeleton.dart';

/// Generic cursor page envelope ({ data, next_cursor, has_more }).
class CursorPage<T> {
  CursorPage({required this.data, this.nextCursor, this.hasMore = false});

  final List<T> data;
  final String? nextCursor;
  final bool hasMore;
}

/// The single cursor list: skeleton → error (with action) → empty (with next
/// action) → rows; pull-to-refresh; "Load more" for screen readers. Never offset
/// pagination — keyset only.
///
/// Every state is recoverable: the error state always offers a retry (the
/// list's own reload, unless the caller supplies its own), and the empty
/// state names the next action.
class PagedList<T> extends StatefulWidget {
  const PagedList({
    super.key,
    required this.loadMore,
    required this.itemBuilder,
    this.emptyMessage,
    this.errorMessage,
    this.onRetry,
    this.offlineCopy = false,
    this.padding = const EdgeInsets.only(bottom: AppSpace.s6),
    this.separator,
  });

  /// Returns a page (or null while loading); throws [HelixErrorLike] on failure.
  final Future<CursorPage<T>?> Function(String? cursor) loadMore;
  final Widget Function(BuildContext context, T item) itemBuilder;
  final String? emptyMessage;
  final String? errorMessage;
  final VoidCallback? onRetry;
  final bool offlineCopy;
  final EdgeInsets padding;
  final Widget? separator;

  @override
  State<PagedList<T>> createState() => _PagedListState<T>();
}

/// Thrown by [PagedList.loadMore] implementations.
class HelixErrorLike implements Exception {
  HelixErrorLike(this.message, {this.actionLabel, this.waitSeconds});
  final String message;
  final String? actionLabel;
  final int? waitSeconds;
}

class _PagedListState<T> extends State<PagedList<T>> {
  final _items = <T>[];
  final _scroll = ScrollController();
  String? _cursor;
  bool _hasMore = true;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String? _errorAction;
  int? _waitSeconds;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final page = await widget.loadMore(null);
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page?.data ?? []);
        _cursor = page?.nextCursor;
        _hasMore = page?.hasMore ?? false;
        _loading = false;
      });
    } on HelixErrorLike catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _errorAction = e.actionLabel;
        _waitSeconds = e.waitSeconds;
        _loading = false;
      });
    } on HelixError catch (e) {
      // The domain error the repository throws. Without this the list would
      // show nothing at all instead of the error state — a blank screen where
      // the user expects "Try again".
      if (!mounted) return;
      // The locale is resolved here, not at the top of _load: this runs from
      // initState, where the Localizations scope does not exist yet.
      final strings = Strings.of(context);
      setState(() {
        _error = strings.error(e.code);
        _errorAction = null;
        _waitSeconds = null;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore || _cursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.loadMore(_cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(page?.data ?? []);
        _cursor = page?.nextCursor;
        _hasMore = page?.hasMore ?? false;
        _loadingMore = false;
      });
    } on HelixErrorLike catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingMore = false;
      });
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(e.message)));
    } on HelixError catch (e) {
      if (!mounted) return;
      final strings = Strings.of(context);
      setState(() {
        _loadingMore = false;
      });
      ScaffoldMessenger.maybeOf(context)
          ?.showSnackBar(SnackBar(content: Text(strings.error(e.code))));
    }
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = Strings.of(context);
    if (_loading) {
      return Padding(
        padding: const EdgeInsets.all(AppSpace.s4),
        child: Column(
          children: [
            for (var i = 0; i < 5; i++)
              const Padding(
                padding: EdgeInsets.only(bottom: AppSpace.s3),
                child: Skeleton(height: 56),
              ),
          ],
        ),
      );
    }
    if (_error != null) {
      return ErrorState(
        message: _error!,
        actionLabel: _errorAction ?? strings.t('actions.retry'),
        onAction: widget.onRetry ?? _load,
        waitSeconds: _waitSeconds,
      );
    }
    if (_items.isEmpty) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.offlineCopy) ...[
            const OfflineTag(),
            const SizedBox(height: AppSpace.s3),
          ],
          EmptyState(
            message: widget.emptyMessage ?? strings.t('state.empty'),
            actionLabel: strings.t('actions.refresh'),
            onAction: widget.onRetry ?? _load,
          ),
        ],
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.accentText,
      backgroundColor: AppColors.surface,
      child: ListView.separated(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: widget.padding,
        itemCount: _items.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, _) => widget.separator ?? const Divider(height: 1),
        itemBuilder: (context, index) {
          if (index >= _items.length) {
            return _loadingMore
                ? const Padding(
                    padding: EdgeInsets.all(AppSpace.s4),
                    child: Center(child: Skeleton(height: 24, width: 120)),
                  )
                : QuietButton(
                    label: strings.t('actions.loadMore'),
                    onPressed: _loadMore,
                  );
          }
          return widget.itemBuilder(context, _items[index]);
        },
      ),
    );
  }
}

/// Page size used for every cursor list (server default 50, max 200).
const kPageSize = Policy.listPageSize;
