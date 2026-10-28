import 'dart:io';

import 'package:dio/dio.dart';
import 'package:dio/io.dart' show IOHttpClientAdapter;
import 'config.dart';
import 'pinning.dart';
import 'errors.dart';
import 'design_preview.dart';
import 'ids.dart';

typedef TokenGetter = Future<String?> Function();
typedef Refresher = Future<bool> Function(); // true when a new access token exists

/// The one HTTP surface. Mirrors the Expo app's apiClient contract:
/// - bearer access token on every call
/// - Idempotency-Key (uuid v4) on every write, unchanged across the 401 replay
/// - 401 → single refresh (collapsed by the session) → replay once
/// - RFC7807 problem bodies → HelixError (branch on error_code only)
class ApiClient {
  ApiClient({
    required this._accessToken,
    required this._refreshTokens,
    required this._onAuthLost,
    Dio? dio,
    SecurityContext? trustContext,
  }) : _dio = dio ?? Dio() {
    if (dio == null) {
      final base = Config.demoOverrideUrl ?? Config.apiBaseUrl;
      _dio.options.baseUrl = _normalizeBase(base);
      // Certificate pinning is installed on every connection the client makes.
      _dio.httpClientAdapter = PinnedHttpClientAdapter(
        pins: Config.sslPins.toSet(),
        failClosed: Config.requirePinning,
        trustContext: trustContext,
      );
    }
    _dio.options
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30)
      ..contentType = 'application/json';
  }

  final TokenGetter _accessToken;
  final Refresher _refreshTokens;
  final void Function() _onAuthLost;
  final Dio _dio;

  static const idemHeader = 'Idempotency-Key';
  static const requestIdHeader = 'X-Request-Id';

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? query,
    required T Function(Object? body) parse,
  }) =>
      _send('GET', path, query: query, parse: parse);

  /// Writes carry an idempotency key. [idempotent] = false for the routes the
  /// backend deliberately excludes (refresh, device refresh, presign, assign).
  Future<T> write<T>(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    String? idempotencyKey,
    bool idempotent = true,
    bool retryOnUnauthorized = true,
    required T Function(Object? body) parse,
  }) =>
      _send(
        method,
        path,
        body: body,
        query: query,
        parse: parse,
        idempotencyKey: idempotencyKey,
        idempotent: idempotent,
        retryOnUnauthorized: retryOnUnauthorized,
      );

  Future<T> delete<T>(String path, {Map<String, dynamic>? query, required T Function(Object? body) parse}) =>
      write('DELETE', path, query: query, parse: parse);

  Future<T> _send<T>(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    String? idempotencyKey,
    bool idempotent = true,
    bool retryOnUnauthorized = true,
    required T Function(Object? body) parse,
  }) async {
    final isWrite = method != 'GET' && method != 'HEAD';
    final key = isWrite && idempotent ? (idempotencyKey ?? newUuid()) : null;
    final response = await _attempt(method, path, body: body, query: query, key: key);

    // The refresh request is the recovery path; it cannot recover itself, and
    // retrying it would re-enter the refresh and deadlock.
    if (response.statusCode == 401 && retryOnUnauthorized) {
      final refreshed = await _refreshTokens();
      if (!refreshed) {
        _onAuthLost();
        throw HelixError.fromProblem({'error_code': 'UNAUTHENTICATED'}, 401);
      }
      final replayed = await _attempt(method, path, body: body, query: query, key: key);
      return _decode(replayed, parse);
    }
    return _decode(response, parse);
  }

  /// Dio joins baseUrl and a RELATIVE path, so the base URL always carries the
  /// trailing slash and app paths never start with one.
  static String _normalizeBase(String baseUrl) => baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
  static String _normalize(String path) => path.startsWith('/') ? path.substring(1) : path;

  Future<Response<dynamic>> _attempt(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    String? key,
  }) async {
    final headers = <String, dynamic>{...await _requestIdHeader()};
    if (key != null) headers[idemHeader] = key;
    final token = await _accessToken();
    if (token != null) headers['Authorization'] = 'Bearer $token';

    // Nulls are skipped: cursor pagination must not send cursor=null.
    final cleanedQuery = <String, dynamic>{};
    if (query != null) {
      query.forEach((k, v) {
        if (v != null) cleanedQuery[k] = v;
      });
    }

    try {
      final response = await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: cleanedQuery.isEmpty ? null : cleanedQuery,
        options: Options(
          method: method,
          headers: headers,
          // 3xx must not be auto-followed: the media route's 302 IS the answer.
          // 401 is returned (not thrown) so _send can refresh-and-replay once.
          followRedirects: false,
          validateStatus: (status) => status != null && status >= 200 && status < 400 || status == 401,
          responseType: ResponseType.json,
        ),
      );
      return response;
    } on DioException catch (e) {
      throw _mapDio(e);
    }
  }

  /// Swaps the HTTP transport for the offline design preview (debug builds).
  HttpClientAdapter? _liveAdapter;

  void usePreviewMode(bool enabled) {
    _liveAdapter ??= _dio.httpClientAdapter;
    _dio.httpClientAdapter = enabled ? PreviewAdapter() : (_liveAdapter ?? IOHttpClientAdapter());
  }

  Future<Map<String, String>> _requestIdHeader() async =>
      {requestIdHeader: newUuid(), 'Accept': 'application/json, application/problem+json'};

  T _decode<T>(Response<dynamic> response, T Function(Object? body) parse) {
    final data = response.data;
    if (response.statusCode != null && response.statusCode! >= 400) {
      throw _problemFrom(response);
    }
    return parse(data);
  }

  Never _problemFrom(Response<dynamic> response) {
    final body = response.data;
    if (body is Map<String, dynamic>) {
      throw HelixError.fromProblem(body, response.statusCode ?? 0);
    }
    if (body is Map) {
      throw HelixError.fromProblem(Map<String, dynamic>.from(body), response.statusCode ?? 0);
    }
    throw HelixError.fromProblem({'error_code': 'TRANSACTION_FAILED'}, response.statusCode ?? 0);
  }

  HelixError _mapDio(DioException e) {
    final response = e.response;
    if (response != null) {
      final body = response.data;
      if (body is Map) {
        return HelixError.fromProblem(Map<String, dynamic>.from(body), response.statusCode ?? 0);
      }
      return HelixError.fromProblem({'error_code': 'TRANSACTION_FAILED'}, response.statusCode ?? 0);
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout ||
        e.type == DioExceptionType.connectionError) {
      return HelixError.network();
    }
    return HelixError.fromProblem({'error_code': 'TRANSACTION_FAILED'}, 0);
  }

  /// Follows `GET /media/:id`'s 302 with the bearer and returns the Location URL.
  Future<String> resolveMediaUrl(String mediaId) async {
    final token = await _accessToken();
    try {
      final response = await _dio.request<dynamic>(
        _normalize('media/$mediaId'),
        options: Options(
          method: 'GET',
          followRedirects: false,
          validateStatus: (s) => s != null && s >= 200 && s < 400,
          headers: {if (token != null) 'Authorization': 'Bearer $token'},
        ),
      );
      final location = response.headers.value('location');
      if (location == null || location.isEmpty) {
        throw HelixError.fromProblem({'error_code': 'NOT_FOUND'}, 404);
      }
      return location;
    } on DioException catch (e) {
      if (e.response != null) throw _problemFrom(e.response!);
      throw HelixError.network();
    }
  }

  /// Raw PUT of staged media bytes to the presigned URL. Content-Type must match
  /// the value used for the presign (it is part of the signature).
  Future<void> putBytes(String url, List<int> bytes, String contentType) async {
    try {
      await _dio.request<dynamic>(
        url,
        data: Stream.value(bytes),
        options: Options(
          method: 'PUT',
          contentType: contentType,
          responseType: ResponseType.bytes,
          // presigned PUTs are cross-origin and never followed
          followRedirects: false,
          validateStatus: (status) => status != null && status >= 200 && status < 300,
        ),
      );
    } on DioException catch (e) {
      if (e.response != null && e.response!.statusCode! >= 400) {
        throw HelixError.fromProblem({'error_code': 'UPLOAD_UNAVAILABLE'}, e.response!.statusCode!);
      }
      throw HelixError.network();
    }
  }
}
