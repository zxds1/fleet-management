import 'package:flutter_test/flutter_test.dart';
import 'package:helix/core/kv_store.dart';
import 'package:helix/core/session.dart';

/// The offline PIN is the only thing standing between a lost device and the
/// driver's cached shift history, fuel records and accident statements, so the
/// verifier has to actually depend on the PIN and the salt.
SessionService _session([KeyValueStore? store]) {
  return SessionService(store: store ?? MemoryKeyValueStore());
}

void main() {
  setUp(() {
    // The production work factor (600k) costs ~12s in the pure-Dart backend
    // the test runner uses; on device the native backend makes it ~0.3s.
    SessionService.pinKdfIterations = 2000;
  });

  tearDown(() => SessionService.pinKdfIterations = SessionService.pinKdfIterationsProduction);

  test('the production work factor is the OWASP recommendation', () {
    expect(SessionService.pinKdfIterationsProduction, 600000);
  });

  test('a PIN verifies only against itself', () async {
    final session = _session();
    await session.setPin('1234');

    final ok = await session.verifyPin('1234');
    expect(ok.isOk, isTrue, reason: 'the correct PIN must unlock');

    final wrong = await session.verifyPin('4321');
    expect(wrong.isOk, isFalse, reason: 'a different PIN must not unlock');
  });

  test('the verifier depends on the salt, not just the PIN', () async {
    final a = _session();
    final b = _session();
    await a.setPin('1234');
    await b.setPin('1234');

    final saltA = await a.store.read(StoreKeys.pinSalt);
    final saltB = await b.store.read(StoreKeys.pinSalt);
    expect(saltA, isNotNull);
    expect(saltA, isNot(saltB), reason: 'each device must get its own salt');

    final hashA = await a.store.read(StoreKeys.pinHash);
    final hashB = await b.store.read(StoreKeys.pinHash);
    expect(hashA, isNot(hashB), reason: 'the same PIN must not hash the same on two devices');
  });

  test('the stored verifier is a KDF envelope, not a bare digest', () async {
    final session = _session();
    await session.setPin('1234');
    final hash = await session.store.read(StoreKeys.pinHash);
    expect(hash, isNotNull);
    expect(hash, startsWith('pbkdf2-sha256\$2000\$'));
    expect(hash!.length, greaterThan(64), reason: 'must carry the derived key material');
    expect(hash, isNot(contains('1234')), reason: 'the PIN must never be stored in the clear');
  });

  test('repeated wrong PINs lock the device out, then wipe it', () async {
    final session = _session();
    await session.setPin('1234');

    PinVerification last = await session.verifyPin('0000');
    for (var i = 0; i < 4; i++) {
      last = await session.verifyPin('0000');
    }
    expect(last.isLocked, isTrue, reason: 'the lockout threshold must lock the device');

    for (var i = 0; i < 6; i++) {
      last = await session.verifyPin('0000');
    }
    expect(last.isWiped, isTrue, reason: 'the wipe threshold must clear the verifier');
    expect(await session.store.read(StoreKeys.pinHash), isNull);
  });
}
