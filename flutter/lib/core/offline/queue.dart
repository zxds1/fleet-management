import 'dart:io';
import '../api_client.dart';
import '../errors.dart';
import '../ids.dart';
import '../policy.dart';
import 'queue_store.dart';
export 'queue_op.dart';
export 'queue_store.dart';

class DrainResult {
  DrainResult({required this.sent, required this.queuedCount, required this.failedIds, this.firstResponse});
  final List<String> sent;
  final int queuedCount;
  final List<int> failedIds;
  final Map<String, dynamic>? firstResponse;
  bool get allSent => failedIds.isEmpty && queuedCount == 0;
}

/// Contract: uploads ONE staged photo (presign → PUT) and returns the
/// media_object_id. Presigns are re-issued on every attempt (60s TTL).
typedef StagedUploader = Future<String> Function(StagedUpload upload);

/// The offline queue: serial, oldest-first drain with idempotent replay,
/// per-attempt re-presign, and produces/needs token chaining between writes.
/// Token substitution works on body VALUES equal to a token and on `{token}`
/// path segments, so clock-in → refuel chains send the real shift_id.
class OfflineQueue {
  OfflineQueue({
    required this._store,
    required this._api,
    required this._uploadStaged,
    required this._onDone,
    required this._refreshIfNeeded,
    required this._isOnline,
  });

  final OfflineQueueStore _store;
  final ApiClient _api;
  final StagedUploader _uploadStaged;
  final void Function(List<String>) _onDone;
  final Future<bool> Function() _refreshIfNeeded;
  final Future<bool> Function() _isOnline;

  bool draining = false;
  final Map<String, String> _refs = {};

  Future<int> get openCount => _store.openCount();
  Future<List<QueueItem>> items() => _store.allRecent();

  /// How many writes are waiting and how many are parked for a person.
  Future<({int pending, int failed})> statusCounts() => _store.statusCounts();
  Future<QueueItem?> itemById(int id) => _store.byId(id);

  /// Try online with a fixed key; on a network failure enqueue the same key.
  Future<void> writeOrQueue(QueueOp op) async {
    if (await _isOnline()) {
      try {
        await _send(op, op.idempotencyKey);
        return;
      } on HelixError catch (e) {
        if (!e.isNetwork) rethrow;
      }
    }
    await enqueue(op);
  }

  /// Queue-first for photo/dependent forms: enqueue all ops in order, drain,
  /// report. Throws the server error so the driver can fix the form.
  ///
  /// A row that ends in FAILED_REVIEW is KEPT: the driver's captured photos
  /// stay on disk and the Outbox "Edit" path can fix and resend the write.
  /// Only an explicit discard deletes a row.
  Future<DrainResult> submitStaged(List<QueueOp> ops) async {
    final submitted = <int>[];
    for (final op in ops) {
      submitted.add(await enqueue(op));
    }
    final result = await drain();
    if (result.failedIds.isNotEmpty) {
      final first = await _store.byId(result.failedIds.first);
      throw HelixError(
        code: first?.lastErrorCode ?? 'TRANSACTION_FAILED',
        status: first?.responseStatus ?? 0,
        detail: first?.lastErrorCode,
      );
    }
    return DrainResult(
      sent: result.sent,
      queuedCount: result.queuedCount,
      failedIds: result.failedIds,
      firstResponse: await _responseFor(submitted),
    );
  }

  /// The response of the write(s) submitted in this call. A drain pass may
  /// also have sent older queued writes, and their response is not ours.
  Future<Map<String, dynamic>?> _responseFor(List<int> ids) async {
    for (final id in ids) {
      final item = await _store.byId(id);
      if (item != null && item.status == QueueStatus.done) return item.responseBody;
    }
    return null;
  }

  Future<int> enqueue(QueueOp op) async {
    final item = QueueItem(
      idempotencyKey: op.idempotencyKey,
      method: op.method,
      path: op.path,
      body: op.body,
      query: op.query,
      uploads: op.uploads,
      produces: op.produces,
      needs: op.needs,
      createdAt: DateTime.now().toUtc(),
    );
    return _store.insert(item);
  }

  Future<void> retry(int id) async {
    final item = await _store.byId(id);
    if (item == null) return;
    item.status = QueueStatus.pending;
    item.attempts = 0;
    item.lastErrorCode = null;
    await _store.update(item);
  }

  /// Edit a FAILED_REVIEW row: a NEW idempotency key, then drain.
  Future<void> edit(int id, Map<String, dynamic> newBody) async {
    final item = await _store.byId(id);
    if (item == null) return;
    item.body
      ..clear()
      ..addAll(newBody);
    item.idempotencyKey = newUuid();
    item.status = QueueStatus.pending;
    item.attempts = 0;
    await _store.update(item);
  }

  Future<void> discard(int id) async {
    final item = await _store.byId(id);
    if (item == null) return;
    item.status = QueueStatus.discarded;
    await _store.update(item);
    await _deleteStagedFiles(item);
  }

  Future<void> clearAll() async {
    final items = await _store.allRecent();
    for (final item in items) {
      await _deleteStagedFiles(item);
    }
    await _store.clearAll();
    _refs.clear();
  }

  Future<void> _deleteStagedFiles(QueueItem item) async {
    for (final upload in item.uploads) {
      final file = File(upload.stagedPath);
      if (file.existsSync()) {
        try {
          file.deleteSync();
        } catch (_) {}
      }
    }
  }

  /// A different user signing in destroys the previous queue — unsent work is
  /// personal data. The owner is persisted, so the check survives a restart.
  Future<void> reconcileOwner(String userId) async {
    final stored = await _store.meta('owner');
    if (stored == null) {
      await _store.setMeta('owner', userId);
      return;
    }
    if (stored != userId) {
      await clearAll();
      await _store.setMeta('owner', userId);
    }
  }

  Future<void> recoverInflight() async {
    final rows = await _store.allRecent();
    for (final item in rows) {
      if (item.status == QueueStatus.inflight) {
        item.status = QueueStatus.pending;
        await _store.update(item);
      }
    }
  }

  /// Rebuild produced-id refs from completed rows (survives a process kill
  /// between chained writes).
  Future<void> _rebuildRefs() async {
    _refs.clear();
    final rows = await _store.allRecent();
    for (final item in rows) {
      if (item.status != QueueStatus.done || item.produces == null) continue;
      final produced = _firstIdField(item.responseBody ?? const {}, item.produces!);
      if (produced != null) _refs[item.produces!] = produced;
    }
  }

  /// Serial drain, oldest first. Stops the pass on a retryable failure;
  /// parks hard 4xx as FAILED_REVIEW and continues.
  Future<DrainResult> drain() async {
    if (draining) {
      return DrainResult(sent: const [], queuedCount: await _store.openCount(), failedIds: const []);
    }
    draining = true;
    final sent = <String>[];
    final failed = <int>[];
    Map<String, dynamic>? firstResponse;
    try {
      await recoverInflight();
      await _rebuildRefs();
      if (!await _isOnline()) {
        return DrainResult(sent: const [], queuedCount: await _store.openCount(), failedIds: const []);
      }
      final items = await _store.openItems();
      for (final item in items) {
        if (item.attempts >= Policy.queueMaxAttempts) {
          item.status = QueueStatus.failedReview;
          item.lastErrorCode ??= 'UPLOAD_UNAVAILABLE';
          await _store.update(item);
          failed.add(item.id!);
          continue;
        }
        if (await _dependencyFailed(item)) {
          item.status = QueueStatus.failedReview;
          item.lastErrorCode = 'DEPENDENCY_FAILED';
          await _store.update(item);
          failed.add(item.id!);
          continue;
        }
        item.status = QueueStatus.inflight;
        await _store.update(item);
        try {
          final response = await _sendItem(item);
          item.status = QueueStatus.done;
          item.responseStatus = 200;
          item.responseBody = response ?? const {};
          firstResponse ??= item.responseBody;
          await _store.update(item);
          if (item.produces != null) {
            final produced = _firstIdField(item.responseBody!, item.produces!);
            if (produced != null) _refs[item.produces!] = produced;
          }
          sent.add(item.path);
          _onDone(queryKeysForPath(item.path));
          await _deleteStagedFiles(item);
        } on HelixError catch (e) {
          item.lastErrorCode = e.code;
          item.responseStatus = e.status;
          if (e.isRetryable) {
            // A write that could not reach the server has not been *tried* in
            // any meaningful sense: a dead zone, a paused app or a captive
            // portal must not exhaust its attempt budget, or a driver who
            // drives through a tunnel loses the shift they clocked in.
            final offline = e.isNetwork;
            if (!offline) item.attempts += 1;
            item.status = !offline && item.attempts >= Policy.queueMaxAttempts
                ? QueueStatus.failedReview
                : QueueStatus.pending;
            await _store.update(item);
            if (item.status == QueueStatus.failedReview) failed.add(item.id!);
            break; // stop the whole pass on a retryable failure
          }
          item.attempts += 1;
          if (e.code == 'IDEMPOTENCY_CONFLICT' || e.code == 'DUPLICATE') {
            item.status = QueueStatus.discarded;
            await _store.update(item);
            await _deleteStagedFiles(item);
            continue;
          }
          if (e.code == 'IDEMPOTENCY_INFLIGHT') {
            item.status = QueueStatus.pending;
            await _store.update(item);
            continue;
          }
          if (e.status == 401) {
            item.status = QueueStatus.pending;
            await _store.update(item);
            final refreshed = await _refreshIfNeeded();
            if (!refreshed) failed.add(item.id!);
            break;
          }
          // other 4xx — park for a person, keep draining the rest
          item.status = QueueStatus.failedReview;
          await _store.update(item);
          failed.add(item.id!);
        }
      }
      await _store.purge(90);
      return DrainResult(
        sent: sent,
        queuedCount: await _store.openCount(),
        failedIds: failed,
        firstResponse: firstResponse,
      );
    } finally {
      draining = false;
    }
  }

  Future<bool> _dependencyFailed(QueueItem item) async {
    for (final token in item.needs) {
      if (!_refs.containsKey(token)) return true;
    }
    return false;
  }

  Future<Map<String, dynamic>?> _sendItem(QueueItem item) async {
    for (final upload in item.uploads) {
      if (upload.mediaObjectId == null) {
        upload.mediaObjectId = await _uploadStaged(upload);
        await _store.update(item); // survives offline-during-upload
      }
    }
    final resolvedBody = _substitute(item);
    final resolvedPath = _substitutePath(item);
    return _sendRaw(item, resolvedPath, resolvedBody);
  }

  Map<String, dynamic> _substitute(QueueItem item) {
    final result = Map<String, dynamic>.of(item.body);
    for (final token in item.needs) {
      _replaceIn(result, token, _refs[token] ?? token);
    }
    for (final upload in item.uploads) {
      _replaceIn(result, upload.slot, upload.mediaObjectId ?? '');
    }
    return result;
  }

  String _substitutePath(QueueItem item) {
    var path = item.path;
    for (final token in item.needs) {
      path = path.replaceAll('{$token}', _refs[token] ?? token);
    }
    return path;
  }

  void _replaceIn(Map<String, dynamic> map, String token, String replacement) {
    for (final key in map.keys.toList()) {
      final value = map[key];
      if (value == token) {
        map[key] = replacement;
      } else if (value is Map<String, dynamic>) {
        _replaceIn(value, token, replacement);
      } else if (value is List) {
        for (var i = 0; i < value.length; i++) {
          if (value[i] == token) value[i] = replacement;
        }
      }
    }
  }

  Future<Map<String, dynamic>?> _sendRaw(
      QueueItem item, String path, Map<String, dynamic> body) async {
    final response = await _api.write<Map<String, dynamic>>(
      item.method,
      path,
      body: body,
      query: item.query.isEmpty ? null : item.query,
      idempotencyKey: item.idempotencyKey,
      parse: (b) => b is Map<String, dynamic> ? b : const {},
    );
    return response;
  }

  Future<Map<String, dynamic>?> _send(QueueOp op, String key) async {
    for (final upload in op.uploads) {
      upload.mediaObjectId ??= await _uploadStaged(upload);
    }
    final tempItem = QueueItem(
      idempotencyKey: key,
      method: op.method,
      path: op.path,
      body: op.body,
      query: op.query,
      uploads: op.uploads,
      produces: op.produces,
      needs: op.needs,
      createdAt: DateTime.now().toUtc(),
    );
    final resolvedBody = _substitute(tempItem);
    final resolvedPath = _substitutePath(tempItem);
    return _sendRaw(tempItem, resolvedPath, resolvedBody);
  }

  String? _firstIdField(Map<String, dynamic> response, String field) {
    final direct = response[field];
    if (direct is String && direct.isNotEmpty) return direct;
    final camel = _camel(field); // media/upload-url + fuel verify are camelCase
    final value = response[camel];
    if (value is String && value.isNotEmpty) return value;
    return null;
  }

  String _camel(String snake) {
    final parts = snake.split('_');
    return parts.first + parts.skip(1).map((p) => p[0].toUpperCase() + p.substring(1)).join();
  }
}

/// Route prefix → query keys to invalidate after a successful send.
List<String> queryKeysForPath(String path) {
  final p = path.startsWith('/') ? path.substring(1) : path;
  if (p.startsWith('shifts')) return ['shift-active', 'shifts'];
  if (p.startsWith('driver/fuel')) return ['fuel', 'vehicle-states'];
  if (p.startsWith('inspections')) return ['inspections'];
  if (p.startsWith('accidents')) return ['accidents'];
  if (p.startsWith('trailer')) return ['trailers', 'vehicle-states'];
  if (p.startsWith('notifications')) return ['notifications', 'badges'];
  return const [];
}
