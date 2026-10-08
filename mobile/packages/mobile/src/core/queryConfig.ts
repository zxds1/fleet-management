import { CACHE_TTL_MS, DISK_CACHE_TTL_MS } from './policy';

const s = 1000, m = 60 * s, h = 60 * m;
/**
 * Per-domain TTLs. The base value comes from the policy file (B-05), so there is one place to change it;
 * a domain listed here overrides it deliberately.
 */
export const QUERY_TTL: Record<string, { staleTime: number; gcTime: number }> = {
  'vehicle-states': { staleTime: CACHE_TTL_MS, gcTime: h },
  'shift-active':   { staleTime: CACHE_TTL_MS, gcTime: h },
  notifications:    { staleTime: 30 * s, gcTime: 5 * m },
  anomalies:        { staleTime: 30 * s, gcTime: 5 * m },
  'fuel-history':   { staleTime: 60 * s, gcTime: 10 * m },
  'dvir-list':      { staleTime: 60 * s, gcTime: 10 * m },
  drivers:          { staleTime: 5 * m, gcTime: 24 * h },
};
export const ttl = (domain: string) => QUERY_TTL[domain] ?? { staleTime: 30 * s, gcTime: 5 * m };
/** B-05: the persisted cache is capped by the persister's maxAge. */
export const PERSIST_MAX_AGE = DISK_CACHE_TTL_MS;
