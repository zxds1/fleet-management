import 'package:flutter_test/flutter_test.dart';
import 'package:helix/core/pinning.dart';

/// The policy the docs claim is shipped: the API's traffic is pinned, and a
/// release build with no pin material refuses to connect at all.
void main() {
  test('the pin list parses from a comma or whitespace separated string', () {
    expect(parsePins('abc, def'), ['abc', 'def']);
    expect(parsePins('abc def  ghi'), ['abc', 'def', 'ghi']);
    expect(parsePins('abc,,abc'), ['abc'], reason: 'duplicates collapse');
    expect(parsePins(''), isEmpty);
    expect(parsePins('   '), isEmpty);
  });

  test('a pinned leaf is accepted — the rotation path', () {
    expect(
      acceptsLeaf(certificateHash: 'AAA', pins: {'AAA'}, failClosed: true, hasTrustContext: false),
      isTrue,
    );
  });

  test('an unpinned leaf is refused when pins are configured', () {
    expect(
      acceptsLeaf(certificateHash: 'BBB', pins: {'AAA'}, failClosed: true, hasTrustContext: true),
      isFalse,
      reason: 'a trusted issuer is not enough when a leaf pin is configured',
    );
  });

  test('with no leaf pins, a strict trust anchor is the control', () {
    expect(
      acceptsLeaf(certificateHash: 'BBB', pins: {}, failClosed: false, hasTrustContext: true),
      isTrue,
    );
    expect(
      acceptsLeaf(certificateHash: 'BBB', pins: {}, failClosed: true, hasTrustContext: true),
      isFalse,
      reason: 'fail-closed refuses when the trust anchor is not strict enough',
    );
  });

  test('with no pin material at all, a release build connects to nothing', () {
    expect(
      acceptsLeaf(certificateHash: 'BBB', pins: {}, failClosed: true, hasTrustContext: false),
      isFalse,
    );
    expect(
      acceptsLeaf(certificateHash: 'BBB', pins: {}, failClosed: false, hasTrustContext: false),
      isFalse,
      reason: 'no pins and no strict anchor means no control at all',
    );
  });

  test('a lowercase hex pin matches a lowercase hex hash', () {
    const hash = 'a1b2c3d4';
    expect(
      acceptsLeaf(certificateHash: hash, pins: {hash}, failClosed: true, hasTrustContext: false),
      isTrue,
    );
  });
}
