# FleetPulse Mobile (Expo / React Native)

A faithful **live** port of the FleetPulse Kotlin app (`kotlin-app`) built with Expo (React Native),
wired to the **real** backend in `packages/api` (no mock data). It mirrors the Kotlin app's
design system, screen structure, shells, auth flow, and offline-first queue.

## Package manager

This monorepo uses **pnpm**. From the repo root:

```bash
pnpm install
```

Then run the mobile app (Expo) and the API in separate terminals:

```bash
# terminal 1 — API (Express, mounts at /api/v1)
pnpm dev:api

# terminal 2 — Expo dev server
cd packages/mobile
pnpm start          # or: pnpm android / pnpm ios
```

`pnpm typecheck` (runs `tsc --noEmit`) must stay green.

## Architecture

| Layer | File | Mirrors (Kotlin) |
| --- | --- | --- |
| Config / API base | `src/config.ts` | `BuildConfig.API_BASE_URL` |
| HTTP client | `src/api/client.ts` | `HttpClient.kt` (AuthInterceptor) — Bearer auth, `Idempotency-Key`, `x-request-id`, RFC7807 → `AppError` with `error_code` |
| State | `src/store.ts` + `src/repo/FleetRepository.ts` | `MutableStateFlow` + `collectAsState` (`useSyncExternalStore`) |
| Domain types | `src/data/types.ts` | `Models.kt` (+ real `Permission` codes) |
| Theme | `src/theme/*` | `Color.kt` / `Theme.kt` (exact bento hex) |
| i18n | `src/data/i18n.ts` | `t(locale, key)` maps (en + sw) |
| Screens | `src/screens/{auth,driver,admin}` | `*.kt` screens |
| Navigation | `src/navigation/*` | shell routing |

### Auth flow
`unauthenticated → (login phone=driver / email=admin) → needs_mfa → needs_consent → authenticated`.
Session (token + principal + device id + consent version) is persisted to `AsyncStorage` and
rehydrated on launch. A suspended account lands on `SuspendedScreen`.

### Shells
`DRIVER` and `ADMIN` are derived from the principal's permissions (`availableShells`). The root
navigator (`RootNavigator.tsx`) branches to `DriverApp` (bottom tabs: Home / Map / Accidents /
Profile) or `AdminApp` (Dashboard / Map / Console / Profile).

### Live data
Every loader in `FleetRepository` calls the real API: `/shifts`, `/fuel`, `/inspections`,
`/accidents` (+`/mayday`), `/anomalies`, `/notifications`, `/training`, `/vehicles`,
`/documents/expiring`, `/drivers`, `/admin/hardware/pending`, `/trailer/assignments`,
`/maintenance`, `/privacy/requests`, `/reports/analytics`, `/dashboard/vehicle-states`,
`/reconciliation/admin/fuel/...`. See `src/api/client.ts` + `src/repo/FleetRepository.ts`.

### Offline-first queue
Writes (clock-in/out, refuel, DVIR, mayday, accident, vehicle issue) are enqueued locally and
drained against the live API with **replay-safe `Idempotency-Key`**s when connectivity returns
(`FleetRepository.drainQueue`). The Outbox screen (`outbox`) shows pending/retried/discarded items.

### API base URL
`src/config.ts` resolves the base URL from `app.json` `expo.extra.apiBaseUrl`, defaulting to
`http://10.0.2.2:8080/api/v1` (Android emulator → host machine). Override with
`EXPO_PUBLIC_API_BASE_URL` for physical devices / iOS.

## Notes
- Design matches the Kotlin `Color.kt` palette exactly (bento dark surfaces, semantic status,
  vehicle display-state precedence colors via `displayStateColor`).
- `react-native-maps` is used for the live vehicle map; it is excluded from the Expo
  `reactNativeDirectoryCheck` in `package.json`.
