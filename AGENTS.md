# Anchored Summary & Engineering Guide — FleetSync Mobile

## Project Context
React Native + Expo (RN 0.86, Expo 57, React 19) mobile client at `packages/mobile/`. It is a dual-shell fleet management app (Driver + Admin shells) that mirrors a Kotlin Android app's UI contract. Currently styled with a **Bento-style dark fleet console palette** (dark backgrounds, rounded cards, Material 3 blue `#3B82F6`).

## Target Design System: Carbon Enterprise System
**Source of truth:** `docs/apps/screens/stitch_fleetflow_mobile_specifications/carbon/DESIGN.md` + per-screen `code.html` specs.

Key rules from Carbon:
- **Light backgrounds** — `#ffffff` canvas, `#f4f4f4` for surface containers, `#161616` text.
- **IBM Blue** `#0f62fe` — primary buttons, links, active states.
- **IBM Plex Sans** — single font family, weights 300/400/600, size hierarchy via weight not huge jumps (body 14px, label 12px, headings 20–32px).
- **Material Symbols** (`Material Symbols Outlined`) — not Ionicons.
- **Squared edges** — `borderRadius: 0` for containers; only cards use `#f4f4f4` background with `border-bottom: 1px solid #e0e0e0`.
- **8px spacing grid** — strict increments of 8 (4 for micro).
- **Inputs** — bottom-border only, 40px height, `#f4f4f4` background, blue focus stripe `#0f62fe`.
- **Buttons** — 48px min, primary = solid blue fill, secondary = outlined, ghost = text-only.
- **Semantic status colors** — success `#198038`, danger `#da1e28`, info `#60a5fa` (blue), warning `#FBBF24` (amber).

## Current Theme (Bento — to be migrated to Carbon)
### `src/theme/colors.ts`
```
bentoBackground: "#0E1116"      → carbon: background: "#ffffff"
bentoCardBg: "#171B22"          → carbon: surface: "#ffffff" / surfaceContainer: "#f4f4f4"
bentoBluePrimary: "#3B82F6"     → carbon: primary: "#0f62fe"
bentoBorder: "#2A313C"          → carbon: outlineVariant: "#e0e0e0"
bentoTextPrimary: "#F4F6FB"     → carbon: onSurface: "#161616"
bentoTextSecondary: "#9AA4B2"   → carbon: secondary: "#6f6f6f" / onSurfaceVariant: "#525252"
bentoBluePrimaryContainer: "#1E3A8A"  → carbon: primaryContainer: "#d0e2ff"
```
Also has: `stateQuarantined/offline/hosAlert/speeding/moving/idling/parked`, `statusSafe/warning/danger/info`, `white`, `transparent`, `radius`, `spacing`.

### `src/theme/typography.ts`
Material3 scale with `fontFamily: undefined`. Carbon needs IBM Plex Sans (300/400/600 weights).

### `src/theme/index.ts`
Re-exports `colors`, `radius`, `spacing` from `colors.ts`, and `typography` from `typography.ts`. Exposes `theme` object.

## Components to Migrate (all currently Bento-styled)
| File | Current style | Carbon changes needed |
|---|---|---|
| `components/Icon.tsx` | Ionicons wrapper | Switch to Material Symbols (need `@expo/vector-icons` Material Symbols or webfont) |
| `components/FleetButton.tsx` | 52px pill, `bentoBluePrimary` fill, `radius.pill` | 48px min, squared (radius 0), solid blue `#0f62fe`, text white |
| `components/Screen.tsx` | `bentoBackground` dark, `bentoCardBg` header, `bentoBorder` | `#ffffff` background, `#e0e0e0` border-bottom on header, squared |
| `components/KpiCard.tsx` | `bentoCardBg` bg, `radius.xl` rounded, `bentoBorder` | `#f4f4f4` bg, `borderRadius: 0`, `#e0e0e0` border |
| `components/AdminRowCard` | `bentoCardBg`, `radius.lg` | `#ffffff` bg, `borderRadius: 0`, `#e0e0e0` border |
| `components/SectionCard.tsx` | `bentoCardBg`, `radius.xl`, `bentoBorder` | `#f4f4f4` bg, `borderRadius: 0`, `#e0e0e0` border |
| `components/StatusChip.tsx` | `color + "26"` alpha bg, `radius.pill` | Carbon-styled status chip — outlined/solid based on severity |
| `components/QuickActionTile.tsx` | `bentoCardBg`, `radius.md`, `bentoBorder`; `TopBarHeader` logo `bentoBluePrimary` | `#f4f4f4` bg, squared, IBM Blue accent |
| `components/States.tsx` | OfflineBanner uses `bentoBlueContainer`/`bentoDarkBadge`, rounded | `#e0e0e0`/`#f4f4f4` backgrounds, squared |
| `components/AuthField.tsx` | `bentoBackground` input bg, `bentoBorder`, `radius.md` | Carbon bottom-border input: `#f4f4f4` bg, `#e0e0e0` border, blue focus |

## Navigation
| File | Bento theme usage | Carbon changes |
|---|---|---|
| `navigation/DriverApp.tsx` | `bentoCardBg` tab bar, `bentoBorder` border, `bentoBluePrimary` active tint | `#ffffff` tab bar, `#e0e0e0` border, `#0f62fe` active tint |
| `navigation/AdminApp.tsx` | Same pattern | Same Carbon changes |
| `navigation/RootNavigator.tsx` | No direct theme usage | No changes needed |

## Screens Using Bento Theme (all need migration)
### Auth Screens
- `screens/auth/AuthScaffold.tsx` — uses `bentoBackground`, `bentoTextPrimary`, `bentoBluePrimary`, `bentoCardBg`, `bentoBorder` for the AuthSegmentedToggle
- `screens/auth/LoginScreen.tsx` — uses `statusWarning`, `statusDanger`, `bentoBluePrimary`, `AuthField`, `FleetButton`
- `screens/auth/SignupScreen.tsx`, `ForgotPasswordScreen.tsx`, `ResetCodeScreen.tsx`, `ResetDoneScreen.tsx`, `ConsentScreen.tsx`, `MfaScreen.tsx` — (need reading)

### Admin Screens
- `screens/admin/DashboardScreen.tsx` — uses `Screen`, `ScreenHeader`, `KpiCard`, `SectionCard`, `bentoTextSecondary`, `bentoTextPrimary`
- `screens/admin/AccidentsConsoleScreen.tsx`, `DvirReviewScreen.tsx`, `FuelReconcileScreen.tsx`, `ImportStatementScreen.tsx`, `DriverRosterScreen.tsx`, `HardwareTrackerScreen.tsx`, `VehicleMasterScreen.tsx`, `MaintenanceScreen.tsx`, `PrivacyScreen.tsx`, `SettingsScreen.tsx` — (need reading)

### Driver Screens
- `screens/driver/DriverHomeScreen.tsx` — uses `SectionCard`, `StatusChip`, `FleetButton`, `QuickActionTile`, `bentoBluePrimary`, `bentoTextPrimary`
- `screens/driver/VehicleStateScreen.tsx` — uses `Screen`, `ScreenHeader`, `SectionCard`, `StatusChip`, `bentoTextPrimary`, `bentoTextSecondary`
- `screens/driver/ClockInScreen.tsx` — uses `AuthField`, `FleetButton`, `bentoBluePrimary`, `bentoBorder`, `bentoBackground`, `radius.pill` selection
- `screens/driver/InspectionScreen.tsx` — uses `AuthField`, `FleetButton`, `bentoBluePrimary`, `bentoBorder`, `radius.pill` selection
- `screens/driver/RefuelScreen.tsx` — uses `AuthField`, `FleetButton`, `SectionCard`, `bentoTextPrimary`, `bentoTextSecondary`
- `screens/driver/AnomaliesScreen.tsx` — uses `SectionCard`, `StatusChip`, `EmptyState`, `bentoTextPrimary`, `bentoTextSecondary`
- `screens/driver/ProfileScreen.tsx` — uses `SectionCard`, `FleetButton`, `bentoBluePrimary`, `bentoCardBg`, `bentoTextPrimary`, `bentoTextSecondary`
- Plus: `AccidentsScreen`, `AnomaliesScreen`, `ClockOutScreen`, `DvirListScreen`, `FuelHistoryScreen`, `NotificationsScreen`, `OnboardingScreens`, `OutboxScreen`, `TrainingHubScreen`, `LessonDetailScreen`, `ResourceLibraryScreen`, `SuspendedScreen`, `VehicleIssueScreen`, `VehicleMapScreen` — (need reading)

## Data Files
- `src/data/constants.ts` — App constants (no theme usage)
- `src/data/types.ts` — Domain models (no theme usage)
- `src/data/i18n.ts` — Translation maps (no theme usage)
- `src/data/i18n.ts` error copy uses `statusDanger` color but colors are in the component, not i18n file

## App Entry
- `packages/mobile/App.tsx` — sets status bar with `bentoBackground` + `light-content`
- `src/store.ts` — Zustand store (no theme usage)
- `src/config.ts` — Config (no theme usage)
- `src/devbypass.ts` — Dev bypass (no theme usage)
- `src/api/client.ts` — API client (no theme usage)
- `src/repo/FleetRepository.ts` — Repository (no theme usage)
- `src/utils/format.ts` — Format utilities (no theme usage)

## Key Design Tokens Mapping (Bento → Carbon)
| Bento token | Hex | Carbon semantic token | Hex |
|---|---|---|---|
| `bentoBackground` | `#0E1116` | `background` | `#ffffff` |
| `bentoCardBg` | `#171B22` | `surfaceContainer` | `#f4f4f4` |
| `bentoBluePrimary` | `#3B82F6` | `primary` | `#0f62fe` |
| `bentoBluePrimaryContainer` | `#1E3A8A` | `primaryContainer` | `#d0e2ff` |
| `bentoTextPrimary` | `#F4F6FB` | `onSurface` | `#161616` |
| `bentoTextSecondary` | `#9AA4B2` | `secondary` / `onSurfaceVariant` | `#6f6f6f` / `#525252` |
| `bentoBorder` | `#2A313C` | `outlineVariant` | `#e0e0e0` |
| `statusDanger` | `#F87171` | `error` | `#da1e28` |
| `statusSuccess` | `#34D399` | `tertiary` | `#198038` |
| `statusWarning` | `#FBBF24` | `warning` (amber) | keep or use `#FBBF24` |

## Radius Mapping
| Bento | px | Carbon |
|---|---|---|
| `radius.sm` | 8 | 0 (squared, except subtle 2px for sub-components) |
| `radius.md` | 12 | 0 |
| `radius.lg` | 16 | 0 |
| `radius.xl` | 20 | 0 |
| `radius.pill` | 999 | 0 (or keep small for chips only) |

## Migration Complete
All Bento → Carbon changes have been applied:
1. `App.tsx` entry point identified at `packages/mobile/App.tsx`
2. All screens and components read
3. Theme migrated: `colors.ts` → Carbon semantic palette, `typography.ts` → IBM Plex Sans
4. Components migrated: squared edges, light backgrounds, IBM Blue primary
5. Navigation tab bars migrated to light theme
6. All screens migrated: `bento*` color references replaced with Carbon semantic tokens via bulk rename
7. Icon system switched from Ionicons to `MaterialIcons` (Material Symbols equivalent in `@expo/vector/icons`)
8. Verified with `tsc --noEmit` — passes clean

## Commands
- `cd packages/mobile && npm run lint` (typecheck: `tsc --noEmit`)
- `cd packages/mobile && npm start` (Expo dev server)
