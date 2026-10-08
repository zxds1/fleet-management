/** ASSUMPTION[T-08]: device integrity is a CLIENT-side verdict only. Play Integrity is not verified by the
 *  backend, so a patched client can lie about all of it; the residual risk is documented, not mitigated. */
import JailMonkey from 'jail-monkey';
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';
import { REQUIRE_PINNING, SSL_PINS_RAW } from './config';
import { parsePins, securityVerdict, type SecurityVerdict } from './core/security';

/** Runs before anything touches the network. Cert pinning is native and needs a dev/EAS build (not Expo Go). */
export async function runSecurityChecks(): Promise<SecurityVerdict> {
  const pins = parsePins(SSL_PINS_RAW);
  if (pins) { try { await initializeSslPinning(pins); } catch { return { ok: false, reason: 'PINNING_NOT_CONFIGURED' }; } }
  const debugged = await Promise.resolve(JailMonkey.isDebuggedMode()).catch(() => false);
  return securityVerdict({ rooted: JailMonkey.isJailBroken(), hooked: JailMonkey.hookDetected(), debugged: !!debugged, requirePinning: REQUIRE_PINNING, pinsConfigured: !!pins, dev: __DEV__ });
}
