const SECRET_KEYS = /^(password|pin|access_token|refresh_token|token|authorization|recovery_code|recovery_codes|mfa_code|secret|provisioning_uri|device_id_hash)$/i;
/** Returns a copy that is safe to log: secrets replaced, long strings cut. Use this for ANY object that goes to a log or crash report. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1)]));
  return v;
}
export const log = { info: (m: string, d?: unknown) => console.info(m, d === undefined ? '' : redact(d)), warn: (m: string, d?: unknown) => console.warn(m, d === undefined ? '' : redact(d)), error: (m: string, d?: unknown) => console.error(m, d === undefined ? '' : redact(d)) };
