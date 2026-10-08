/** Pure parsing/validation for SSL pin config and the device-integrity verdict so they can be unit tested. */
export function parsePins(raw: string | undefined): Record<string, { publicKeyHashes: string[] }> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, string[]>;
    const out: Record<string, { publicKeyHashes: string[] }> = {};
    for (const [host, hashes] of Object.entries(obj)) {
      const clean = (Array.isArray(hashes) ? hashes : []).map((h) => String(h).replace(/^sha256\//, '').trim()).filter((h) => /^[A-Za-z0-9+/]{43}=$/.test(h));
      if (clean.length < 2) return null;   // always ship a backup pin, or a cert rotation bricks every installed app
      out[host] = { publicKeyHashes: clean };
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
export type SecurityReason = 'ROOTED' | 'HOOKED' | 'DEBUGGED' | 'PINNING_NOT_CONFIGURED';
export type SecurityVerdict = { ok: true } | { ok: false; reason: SecurityReason };
export interface SecurityInput { rooted: boolean; hooked: boolean; debugged: boolean; requirePinning: boolean; pinsConfigured: boolean; dev: boolean }
/** Release builds refuse rooted devices, instrumentation frameworks (Frida/Xposed) and attached debuggers; and refuse to run without pins when pinning is required. */
export function securityVerdict(i: SecurityInput): SecurityVerdict {
  if (!i.dev) {
    if (i.rooted) return { ok: false, reason: 'ROOTED' };
    if (i.hooked) return { ok: false, reason: 'HOOKED' };
    if (i.debugged) return { ok: false, reason: 'DEBUGGED' };
  }
  if (i.requirePinning && !i.pinsConfigured) return { ok: false, reason: 'PINNING_NOT_CONFIGURED' };   // fail closed
  return { ok: true };
}
