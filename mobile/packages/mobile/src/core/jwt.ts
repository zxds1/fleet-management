/**
 * Reads claims from a JWT for ROUTING only. The server still enforces everything, and the app never
 * authorises from a token: `sub`, `email`, `tid`, `roles`, `permissions`, `sid`, `locale` are the real claim
 * set (`fleet-management/packages/api/src/security/tokens.ts`), and there is NO `name` claim.
 */
export function decodeJwt(token: string | null): { sub?: string; exp?: number; email?: string; name?: string } | null {
  if (!token) return null;
  const part = token.split('.')[1]; if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const claims = JSON.parse(decodeURIComponent(json.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    return typeof claims === 'object' && claims ? claims : null;
  } catch { return null; }
}
