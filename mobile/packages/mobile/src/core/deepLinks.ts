/** Deep-link validation: only our scheme, only known routes, only well-formed ids, and role-gated. Anything else is dropped. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Role = 'DRIVER' | 'ADMIN';
export interface Target { screen: string; params?: Record<string, string>; roles: Role[] }

const ROUTES: Record<string, { screen: string; roles: Role[]; needsId: boolean }> = {
  accident: { screen: 'AccidentDetail', roles: ['ADMIN', 'DRIVER'], needsId: true },
  dvir: { screen: 'DvirReview', roles: ['ADMIN'], needsId: true },
  fuel: { screen: 'FuelReview', roles: ['ADMIN'], needsId: true },
  vehicle: { screen: 'Map', roles: ['ADMIN'], needsId: true },
  notifications: { screen: 'Notifications', roles: ['ADMIN', 'DRIVER'], needsId: false },
  outbox: { screen: 'Outbox', roles: ['DRIVER'], needsId: false },
};

export function parseDeepLink(url: string, role: Role | null): Target | null {
  if (!role || typeof url !== 'string' || url.length > 200) return null;
  const m = /^helix:\/\/([a-z]+)(?:\/([^/?#]+))?$/.exec(url);   // no query, no fragment, no extra segments
  if (!m) return null;
  return build(m[1] ?? '', m[2], role);
}
/** Push payloads carry { entity, id }. Same rules as a URL. */
export function targetFromNotification(data: unknown, role: Role | null): Target | null {
  if (!role || !data || typeof data !== 'object') return null;
  const { entity, id } = data as { entity?: unknown; id?: unknown };
  if (typeof entity !== 'string') return null;
  return build(entity.toLowerCase(), typeof id === 'string' ? id : undefined, role);
}
function build(key: string, id: string | undefined, role: Role): Target | null {
  const r = ROUTES[key]; if (!r || !r.roles.includes(role)) return null;
  if (r.needsId) { if (!id || !UUID.test(id)) return null; return { screen: r.screen, params: { id }, roles: r.roles }; }
  if (id) return null;
  return { screen: r.screen, roles: r.roles };
}
