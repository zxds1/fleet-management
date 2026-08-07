# Mobile Apps — Caching Strategy (`caching.md`)

**Status:** Design (no code). **Companion to:** `00-overview.md`, `flows.md`, `IMPLEMENTATION-PROMPT.md`.
**Decisions (approved):** unified offline-safe strategy · encrypted MMKV persistence · socket events
invalidate + refetch · per-domain TTLs · cache images + map tiles · prefetch on launch + reconnect.

Goal: make both apps feel instant and frustrations-free — fast first paint (even offline), no blank
screens, fresh data after real-time events, and PII protected at rest (Kenya DPA 2019).

---

## 1. Layered caching model

```
┌─ Secure store (expo-secure-store, biometric-gated) ── access/refresh tokens, offline PIN hash,
│                                                     crypto key for MMKV. NEVER in query cache.
├─ Query cache (TanStack Query) ── persisted to ENCRYPTED MMKV (survives restart + offline reads)
│     • per-domain staleTime/gcTime (§3)            • socket → invalidate + refetch (§4)
│     • prefetch on launch + reconnect (§5)
├─ Media cache ── expo-image disk cache (S3 photos) + provider map-tile cache (§6)
├─ Config cache ── ConfigClient values in MMKV (§7)
└─ Offline queue (expo-sqlite) ── pending writes; separate from query cache (§8)
```

Single unified strategy for driver + admin (D: unified offline-safe). Driver benefits most offline;
admin gets the same safety with no extra cost.

---

## 2. Storage: encrypted MMKV

- Use `react-native-mmkv` with an **encryption key** held in `expo-secure-store` (biometric-gated per
  D-11). The key decrypts the MMKV instance; PII on disk is encrypted at rest.
- Persist the TanStack Query cache with `persistQueryClient` → an MMKV-backed `Persistor`
  (`maxAge` ~ 7 days, `bumpQueryTs` on restore so restored data is treated as stale and refetched).
- **Never** put tokens, the offline PIN hash, or raw secrets in the query cache. Those live only in the
  secure store (§1).
- Eviction: `gcTime` per domain (§3); MMKV total size bounded (e.g. 50 MB) with LRU-ish churn via
  `gcTime`.

---

## 3. Per-domain TTL table

`staleTime` = serve from cache without refetch; `gcTime` = retain in MMKV after unused.

| Domain / endpoint | staleTime | gcTime | Notes |
|---|---|---|---|
| Vehicle display state — `GET /dashboard/vehicle-states`, `driver:vehicle`, `map:vehicle-states` | **10 s** | 1 h | volatile; socket also invalidates |
| Active shift — `GET /shifts/me/active` | **10 s** | 1 h | re-fetch after clock in/out |
| Feeds — `GET /anomalies`, `GET /notifications`, accident queue, `GET /fuel/reconciliation-inbox`, DVIR review queue | **30 s** | 5 min | socket also invalidates |
| History/detail — My Shifts, Fuel History, DVIR list/detail, Accident detail, Documents expiring | **60 s** | 10 min | |
| Reference — Drivers list/detail, inspection templates, assignments, `ConfigClient` values | **300 s** | 1 d | changes are rare |
| Cursor pages — any list with `cursor` | per above by domain | per above | keep `next_cursor` in cache for seamless "load more" |

Lists use `keepPreviousData` so pagination/scroll never flashes blank.

---

## 4. Real-time → cache invalidation

Socket events **invalidate** the affected query keys (TanStack `queryClient.invalidateQueries`); the
query refetches in the background (data stays visible, `isFetching` shows a subtle refresh). Never patch
from the payload alone (avoids drift).

| Socket event | Invalidate query keys |
|---|---|
| `driver:vehicle` | `vehicle-states` (own), `shift-active` |
| `driver:shift` | `shift-active`, `my-shifts` |
| `driver:accident` | `accidents` (list), `accident-detail:{id}` |
| `notifications` | `notifications`, dashboard badge |
| `map:vehicle-states` | `vehicle-states` (fleet) |
| `accident:live` | `accidents` (queue), `accident-detail:{id}`, dashboard counts |

On (re)connect the gateway sends a **snapshot** — use it to seed/correct the cache, then resume normal
invalidation.

---

## 5. Prefetch (launch + reconnect)

Avoid blank screens by warming critical queries:

- **On app launch (post-login, per role):**
  - Driver: `shift-active`, `vehicle-states` (own), `notifications`, `anomalies` (badge count).
  - Admin: dashboard counts, `vehicle-states` (fleet), accident queue, DVIR review queue, fuel
    reconciliation inbox, `anomalies`, `notifications`, `documents/expiring`.
- **On regaining connectivity:** re-run the launch prefetch **and** flush the offline queue (§8);
  also refetch any query key currently mounted/observed on the visible screen.
- Implementation: a `prefetchCritical(role)` helper called from `App.tsx` boot and from the
  connectivity listener; use `queryClient.prefetchQuery` with the per-domain staleTimes so already-fresh
  data isn't needlessly refetched.

---

## 6. Media caching (images + map tiles)

- **Photos (DVIR / accident / clock-in / documents):** render via `expo-image` with
  `cachePolicy="memory-disk"`. Cache keyed by the **stable** media id/URL (prefer
  `media_object_id` over rotating presigned GET URLs where the API allows a stable display URL).
- **Uploads** still go via presigned PUT (D5/C5.3); the cache only affects *display* of already-stored
  media. Offline-captured photos (D-6) are stored locally and surfaced immediately from the local file
  until uploaded, then swapped to the cached remote URL.
- **Map tiles:** `react-native-maps` (Google provider, D-9) caches tiles via the platform tile cache
  (best-effort offline for recently viewed areas). Full offline region download is **out of scope**
  (decision: best-effort only); note this limit in the driver "My Vehicle" screen when offline.

---

## 7. Config cache

- `ConfigClient` values (thresholds, quiet hours, retention classes) are fetched once per session and
  held in MMKV; the UI reads them synchronously (no spinner). Refresh on app focus if older than the
  server TTL, or on a `config` socket event if one is added later.

---

## 8. Interaction with the offline queue

- Reads **always** serve from cache when offline (stale + "offline" badge per `flows.md` state matrix);
  the queue only affects **writes**.
- A queued write shows an optimistic local state (e.g., "Pending" shift card) but is **not** written
  into the query cache as server truth.
- On flush success → `invalidateQueries` for the affected key so the real server row replaces the
  optimistic view. On `FAILED_REVIEW` → keep optimistic/pending UI, surface `error_code` (D-7).
- The Outbox screen reads from `expo-sqlite`, not the query cache.

---

## 9. Privacy & safety

- PII (driver names, GPS positions, accident details) is encrypted at rest via encrypted MMKV (§2).
- Tokens / offline PIN hash / crypto key → secure store only.
- On logout / `ACCOUNT_SUSPENDED` → clear the query cache + MMKV + secure store.
- Respect `operational_date`/UTC: cache stores server UTC; format at the edge (A2.3).

## 10. Invariants this document locks

1. Unified offline-safe strategy for driver + admin.
2. Query cache persisted to **encrypted** MMKV; tokens/secrets never cached.
3. Socket events **invalidate + refetch** (no silent payload patching).
4. Per-domain TTLs from §3; cursor lists keep `next_cursor` + `keepPreviousData`.
5. Cache images (S3) + map tiles (best-effort); full offline maps out of scope.
6. Prefetch critical queries on **launch + reconnect**.
7. Logout/suspension clears all caches.
