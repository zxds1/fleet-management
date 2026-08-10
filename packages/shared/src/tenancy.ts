// packages/shared/src/tenancy.ts
// The tenancy kernel shared by @fleet/api, @fleet/worker, @fleet/ws and the mobile client.
//
// Three things live here because all four packages must agree on them exactly:
//   1. BOOTSTRAP_TENANT_ID — the fixed tenant every pre-tenancy row was back-filled to
//      (db/schema/14_tenancy.sql). Fixtures, seeds and tests all reference this constant
//      rather than repeating the literal.
//   2. Redis key namespacing — every key is prefixed `tenant:{tenantId}:` so a key collision
//      across tenants is structurally impossible, not merely unlikely.
//   3. Realtime room naming — the gateway joins sockets to `tenant:{tenantId}` derived rooms
//      so a broadcast physically cannot reach another tenant's sockets.
//
// The GUC names are also fixed here so the SET LOCAL in the API and the RLS policy in
// 14_tenancy.sql can never drift apart.

/**
 * The tenant that owns every row created before multi-tenancy existed. Inserted by
 * db/schema/14_tenancy.sql as the DEFAULT for every back-filled `tenant_id` column.
 */
export const BOOTSTRAP_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** Postgres GUC read by the `tenant_isolation` RLS policy. */
export const TENANT_GUC = "app.current_tenant_id";

/** Postgres GUC read by the SYSTEM_ADMIN RLS bypass. */
export const ROLE_GUC = "app.current_role";

/** The role that bypasses `tenant_isolation`. Platform staff only; never granted by invite. */
export const SYSTEM_ADMIN_ROLE = "SYSTEM_ADMIN";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards a tenant id before it reaches a `SET LOCAL`, a Redis key or a room name.
 *
 * `SET LOCAL` cannot use a bind parameter, so the value is interpolated — this check plus the
 * uuid cast in the RLS policy is what keeps that safe. Anything that is not a well-formed uuid
 * is rejected outright rather than coerced.
 */
export function assertTenantId(tenantId: string): string {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${String(tenantId)}`);
  }
  return tenantId.toLowerCase();
}

/** True when `value` is a syntactically valid tenant id. */
export function isTenantId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------------------------------------------------------- Redis namespacing

/** Prefix every Redis key with the owning tenant: `tenant:{tenantId}:{key}`. */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  return `tenant:${assertTenantId(tenantId)}:${parts.join(":")}`;
}

/** Session set for the 10-session cap (A1.6), namespaced per tenant. */
export function tenantSessionKey(tenantId: string, userId: string): string {
  return tenantKey(tenantId, "user", userId, "sessions");
}

/** Per-tenant config cache key so one tenant's overrides cannot be served to another. */
export function tenantConfigKey(tenantId: string, configKey: string): string {
  return tenantKey(tenantId, "config", configKey);
}

// ---------------------------------------------------------------- Realtime rooms

/** The tenant-wide room. Every socket joins exactly one of these at connect time. */
export function tenantRoom(tenantId: string): string {
  return `tenant:${assertTenantId(tenantId)}`;
}

/**
 * A channel room scoped to one tenant, e.g. `tenant:{id}:map:vehicle-states`. The gateway emits
 * to these instead of the bare event name, so a fan-out is bounded by the tenant by construction.
 */
export function tenantChannelRoom(tenantId: string, channelOrEvent: string): string {
  return `${tenantRoom(tenantId)}:${channelOrEvent}`;
}

/** Per-user room inside a tenant (notifications). */
export function tenantUserRoom(tenantId: string, userId: string): string {
  return `${tenantRoom(tenantId)}:user:${userId}`;
}

/**
 * Envelope every cross-process realtime payload carries so the gateway can route a message to the
 * right tenant room without re-querying the database.
 */
export interface TenantScopedEvent<T = unknown> {
  tenantId: string;
  payload: T;
}

/** Wraps a payload for publication on a tenant-scoped channel. */
export function tenantEvent<T>(tenantId: string, payload: T): TenantScopedEvent<T> {
  return { tenantId: assertTenantId(tenantId), payload };
}

/**
 * Reads a `TenantScopedEvent` off the bus. Returns null when the envelope is missing or malformed,
 * which the gateway treats as "drop it" — an unroutable event must never be broadcast widely.
 */
export function readTenantEvent<T = unknown>(raw: unknown): TenantScopedEvent<T> | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { tenantId?: unknown; payload?: unknown };
  if (!isTenantId(candidate.tenantId)) return null;
  return { tenantId: candidate.tenantId, payload: candidate.payload as T };
}
