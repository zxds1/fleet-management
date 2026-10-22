import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
export 'queue_op.dart';

enum QueueStatus { pending, inflight, done, failedReview, discarded }

String queueStatusName(QueueStatus s) => switch (s) {
      QueueStatus.pending => 'PENDING',
      QueueStatus.inflight => 'INFLIGHT',
      QueueStatus.done => 'DONE',
      QueueStatus.failedReview => 'FAILED_REVIEW',
      QueueStatus.discarded => 'DISCARDED',
    };

QueueStatus queueStatusFromName(String s) => switch (s) {
      'INFLIGHT' => QueueStatus.inflight,
      'DONE' => QueueStatus.done,
      'FAILED_REVIEW' => QueueStatus.failedReview,
      'DISCARDED' => QueueStatus.discarded,
      _ => QueueStatus.pending,
    };

/// A staged photo waiting for its presign→PUT. `slot` is a placeholder token
/// (e.g. `media://receipt`) substituted into the body at send time.
class StagedUpload {
  StagedUpload({
    required this.slot,
    required this.stagedPath,
    required this.contentType,
    required this.ownerKind,
    required this.retentionClass,
    this.widthPx,
    this.heightPx,
    this.mediaObjectId,
  });

  final String slot;
  final String stagedPath;
  final String contentType;
  final String ownerKind;
  final String retentionClass;
  final int? widthPx;
  final int? heightPx;
  String? mediaObjectId;

  Map<String, dynamic> toJson() => {
        'slot': slot,
        'stagedPath': stagedPath,
        'contentType': contentType,
        'ownerKind': ownerKind,
        'retentionClass': retentionClass,
        'widthPx': widthPx,
        'heightPx': heightPx,
        'mediaObjectId': mediaObjectId,
      };

  static StagedUpload fromJson(Map<String, dynamic> j) => StagedUpload(
        slot: j['slot'] as String,
        stagedPath: j['stagedPath'] as String,
        contentType: j['contentType'] as String,
        ownerKind: j['ownerKind'] as String,
        retentionClass: j['retentionClass'] as String,
        widthPx: j['widthPx'] as int?,
        heightPx: j['heightPx'] as int?,
        mediaObjectId: j['mediaObjectId'] as String?,
      );
}

class QueueItem {
  QueueItem({
    this.id,
    required this.idempotencyKey,
    required this.method,
    required this.path,
    required this.body,
    this.query = const {},
    this.uploads = const [],
    this.produces,
    this.needs = const [],
    this.status = QueueStatus.pending,
    this.attempts = 0,
    this.lastErrorCode,
    this.responseStatus,
    this.responseBody,
    required this.createdAt,
  });

  final int? id;
  String idempotencyKey;
  final String method;
  final String path;
  final Map<String, dynamic> body;
  final Map<String, dynamic> query;
  final List<StagedUpload> uploads;
  final String? produces; // body field receiving this write's produced id
  final List<String> needs; // tokens this write consumes
  QueueStatus status;
  int attempts;
  String? lastErrorCode;
  int? responseStatus;
  Map<String, dynamic>? responseBody;
  final DateTime createdAt;

  bool get isWrite => method != 'GET';
}

class OfflineQueueStore {
  OfflineQueueStore(this._db);
  final Database _db;

  static const table = 'offline_queue';

  static Future<OfflineQueueStore> open(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS $table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        body TEXT NOT NULL,
        query TEXT NOT NULL,
        uploads TEXT NOT NULL,
        produces TEXT,
        needs TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        response_status INTEGER,
        response_body TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    ''');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_queue_status_id ON $table (status, id)');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS queue_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');
    return OfflineQueueStore(db);
  }

  Future<String?> meta(String key) async {
    final rows = await _db.query('queue_meta', where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setMeta(String key, String value) async {
    await _db.insert(
      'queue_meta',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<int> insert(QueueItem item) async {
    final now = DateTime.now().toUtc().millisecondsSinceEpoch;
    return _db.insert(table, {
      'idempotency_key': item.idempotencyKey,
      'method': item.method,
      'path': item.path,
      'body': jsonEncode(item.body),
      'query': jsonEncode(item.query),
      'uploads': jsonEncode(item.uploads.map((u) => u.toJson()).toList()),
      'produces': item.produces,
      'needs': jsonEncode(item.needs),
      'status': queueStatusName(item.status),
      'attempts': item.attempts,
      'last_error_code': item.lastErrorCode,
      'response_status': item.responseStatus,
      'response_body': item.responseBody == null ? null : jsonEncode(item.responseBody),
      'created_at': item.createdAt.millisecondsSinceEpoch,
      'updated_at': now,
    });
  }

  Future<void> update(QueueItem item) async {
    final now = DateTime.now().toUtc().millisecondsSinceEpoch;
    await _db.update(
      table,
      {
        'idempotency_key': item.idempotencyKey,
        'method': item.method,
        'path': item.path,
        'body': jsonEncode(item.body),
        'query': jsonEncode(item.query),
        'uploads': jsonEncode(item.uploads.map((u) => u.toJson()).toList()),
        'produces': item.produces,
        'needs': jsonEncode(item.needs),
        'status': queueStatusName(item.status),
        'attempts': item.attempts,
        'last_error_code': item.lastErrorCode,
        'response_status': item.responseStatus,
        'response_body': item.responseBody == null ? null : jsonEncode(item.responseBody),
        'updated_at': now,
      },
      where: 'id = ?',
      whereArgs: [item.id],
    );
  }

  Future<List<QueueItem>> openItems() async {
    // Only PENDING rows are re-POSTed: a FAILED_REVIEW row already met a
    // permanent 4xx and waits for a person to edit or discard it.
    final rows = await _db.query(table, where: "status = 'PENDING'", orderBy: 'id ASC');
    return rows.map(_fromRow).toList();
  }

  Future<List<QueueItem>> allRecent() async {
    final rows = await _db.query(table, orderBy: 'id DESC', limit: 200);
    return rows.map(_fromRow).toList();
  }

  /// How many rows are waiting and how many are parked. One grouped query, so
  /// the status bar can poll it without reading the queue.
  Future<({int pending, int failed})> statusCounts() async {
    final rows = await _db.rawQuery(
      "SELECT status, COUNT(*) as c FROM $table WHERE status IN ('PENDING','FAILED_REVIEW') GROUP BY status",
    );
    var pending = 0;
    var failed = 0;
    for (final row in rows) {
      final count = (row['c'] as int?) ?? 0;
      if (row['status'] == 'PENDING') {
        pending = count;
      } else if (row['status'] == 'FAILED_REVIEW') {
        failed = count;
      }
    }
    return (pending: pending, failed: failed);
  }

  Future<int> openCount() async {
    final result = await _db.rawQuery(
        "SELECT COUNT(*) as c FROM $table WHERE status IN ('PENDING','FAILED_REVIEW','INFLIGHT')");
    return Sqflite.firstIntValue(result) ?? 0;
  }

  Future<QueueItem?> byId(int id) async {
    final rows = await _db.query(table, where: 'id = ?', whereArgs: [id]);
    return rows.isEmpty ? null : _fromRow(rows.first);
  }

  Future<void> clearAll() async => _db.delete(table);

  /// Purge terminal rows older than [resetAfterDays]; keep PENDING/FAILED_REVIEW.
  Future<void> purge(int resetAfterDays) async {
    final cutoff = DateTime.now().toUtc().subtract(Duration(days: resetAfterDays)).millisecondsSinceEpoch;
    await _db.delete(
      table,
      where: "status IN ('DONE','DISCARDED') AND updated_at < ?",
      whereArgs: [cutoff],
    );
  }

  QueueItem _fromRow(Map<String, dynamic> row) {
    final uploadsRaw = jsonDecode(row['uploads'] as String) as List;
    final responseRaw = row['response_body'] as String?;
    return QueueItem(
      id: row['id'] as int,
      idempotencyKey: row['idempotency_key'] as String,
      method: row['method'] as String,
      path: row['path'] as String,
      body: jsonDecode(row['body'] as String) as Map<String, dynamic>,
      query: jsonDecode(row['query'] as String) as Map<String, dynamic>,
      uploads: uploadsRaw.map((u) => StagedUpload.fromJson(u as Map<String, dynamic>)).toList(),
      produces: row['produces'] as String?,
      needs: (jsonDecode(row['needs'] as String) as List).cast<String>(),
      status: queueStatusFromName(row['status'] as String),
      attempts: row['attempts'] as int,
      lastErrorCode: row['last_error_code'] as String?,
      responseStatus: row['response_status'] as int?,
      responseBody: responseRaw == null ? null : jsonDecode(responseRaw) as Map<String, dynamic>,
      createdAt: DateTime.fromMillisecondsSinceEpoch(row['created_at'] as int, isUtc: true),
    );
  }
}

/// Staged photo staging dir: `<app support>/helix/outbox`.
///
/// The application-support directory is excluded from the iOS user backup and
/// is not user-visible on Android — the documents directory was neither.
Future<Directory> stagingDir() async {
  final support = await getApplicationSupportDirectory();
  final dir = Directory(p.join(support.path, 'helix', 'outbox'));
  if (!dir.existsSync()) dir.createSync(recursive: true);
  return dir;
}

/// Where the offline queue database lives. The composition root
/// (app/container.dart) opens the database at this path.
Future<String> queueDatabasePath() async {
  final support = await getApplicationSupportDirectory();
  final dir = Directory(p.join(support.path, 'helix'));
  if (!dir.existsSync()) dir.createSync(recursive: true);
  return p.join(dir.path, 'helix_queue.db');
}

Future<void> wipeStaging() async {
  final dir = await stagingDir();
  if (dir.existsSync()) dir.deleteSync(recursive: true);
}
