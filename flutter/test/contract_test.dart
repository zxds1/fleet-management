import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:helix/core/api_client.dart';
import 'package:helix/core/errors.dart';
import 'package:helix/core/kv_store.dart';
import 'package:helix/core/media.dart';
import 'package:helix/core/session.dart';

import 'mock_backend.dart';

/// The client and the API have to agree on the wire format.
///
/// The mock backend in `mock_backend.dart` is a test double for the real API
/// in `packages/api`. When the two drift, the suite keeps passing while
/// production breaks — which is exactly what happened with the media presign
/// response, where the API and the OpenAPI document are snake_case and the
/// client was reading camelCase. These tests drive the *production* code
/// paths against the mock, so a contract change breaks here first.
void main() {
  late MockBackend backend;
  late SessionService session;
  late ApiClient api;

  setUp(() async {
    backend = MockBackend();
    await backend.start();
    session = SessionService(store: MemoryKeyValueStore());
    api = ApiClient(
      accessToken: () async => session.accessToken,
      refreshTokens: () => session.refreshIfNeeded(),
      onAuthLost: () => session.signOut(),
      dio: Dio(BaseOptions(
        baseUrl: '${backend.apiBase}/',
        contentType: 'application/json',
      )),
    );
    session.attachApi(api);
  });

  tearDown(() async => backend.stop());

  test('sign-in goes to the Helix API, not to an identity provider', () async {
    final body = await session.login(
      email: 'amina@example.com',
      password: 'correct-horse',
    );

    expect(body, isNotNull);
    expect(body!.accessToken, isNotEmpty);
    expect(body.refreshToken, isNotEmpty,
        reason: 'the durable half of the session must be issued');
    expect(body.roles, contains('DRIVER'));
    expect(body.permissions, isNotEmpty);
    expect(session.status, AuthStatus.signedIn);
  });

  test('the server is the source of truth for roles and permissions', () async {
    await session.login(email: 'amina@example.com', password: 'correct-horse');
    expect(session.roles, isNotEmpty);
    expect(session.permissions, isNotEmpty);
    expect(session.userId, isNotNull);
  });

  test('a bad password surfaces the server error rather than a generic one', () async {
    await expectLater(
      session.login(email: 'amina@example.com', password: 'wrong'),
      throwsA(isA<HelixError>().having((e) => e.code, 'code', 'UNAUTHENTICATED')),
    );
    expect(session.status, isNot(AuthStatus.signedIn));
  });

  test('a refresh rotates the refresh token', () async {
    // The client caches the access token's expiry, so the token has to be
    // issued already stale for the refresh path to be taken.
    backend.expireAccessTokens = true;
    await session.login(email: 'amina@example.com', password: 'correct-horse');
    final first = await session.store.read(StoreKeys.refreshToken);
    expect(first, isNotNull);

    final refreshed = await session.refreshIfNeeded();
    expect(refreshed, isTrue);
    expect(backend.refreshCount, 1);
    final second = await session.store.read(StoreKeys.refreshToken);
    expect(second, isNot(first), reason: 'the server rotates the refresh token');
  });

  test('a stale refresh token is rejected and the session is dropped', () async {
    backend.expireAccessTokens = true;
    await session.login(email: 'amina@example.com', password: 'correct-horse');
    await session.store.write(StoreKeys.refreshToken, 'refresh-not-a-real-token');
    final refreshed = await session.refreshIfNeeded();
    expect(refreshed, isFalse);
    expect(session.status, AuthStatus.signedOut);
  });

  test('the media presign response is snake_case, like every other endpoint',
      () async {
    await session.login(email: 'amina@example.com', password: 'correct-horse');
    // The client reads media_object_id / upload_url. The API and the OpenAPI
    // document both use snake_case; a camelCase response would null-check
    // crash on every upload.
    final res = await api.write<Map<String, dynamic>>(
      'POST',
      'media/upload-url',
      body: {
        'owner_kind': MediaService.ownerWorkLog,
        'retention_class': MediaService.retentionReceipt,
        'content_type': 'image/jpeg',
      },
      idempotent: false,
      parse: (b) => b as Map<String, dynamic>,
    );

    expect(res['media_object_id'], isA<String>());
    expect(res['upload_url'], isA<String>());
    expect(res['mediaObjectId'], isNull,
        reason: 'the camelCase alias must not creep back in');
  });
}
