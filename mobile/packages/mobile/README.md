# Helix (@helix/mobile)

Expo / React Native (SDK 54), TypeScript strict. One app, two experiences: driver (phone) and admin (tablet), chosen by role.
Monorepo: `packages/shared` (`@fleet/shared`, contracts and pure logic), `packages/mobile` (this app), `packages/ws` (reference realtime gateway).

    npm install --legacy-peer-deps      # at the repo root (npm workspaces)
    npm test                            # shared + mobile: 303 tests (unit, contract, real-HTTP integration, guards)
    npm run typecheck
    cd packages/mobile && npm run test:coverage   # core logic coverage with 80% thresholds
    APP_VARIANT=admin npx expo start    # dev build required (MMKV, pinning, root detection are native)
    eas build --profile driver|admin

Build environment: `API_BASE_URL`, `WS_URL`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVICES_JSON` (FCM), `ADMIN_CONTACT` (`tel:` or `mailto:`), and
`SSL_PINS` = JSON like `{"api.fleet.internal":["<sha256 SPKI base64>","<backup pin>"]}` (two pins minimum per host).
Release profiles set `REQUIRE_PINNING=1`: with no valid pins the app refuses to start.

First run: copy `.env.example`, then `eas build --profile development` (driver) or `development-admin`, install the dev client, run `npx expo start --dev-client`.

Read next: **`docs/ASSUMPTIONS.md` (97 guesses and uncertainties; start with the 6 blockers)**, `docs/REVIEW.md` (what was found and fixed), `docs/SCREENS.md`, `docs/ASSUMPTIONS.md` (API guesses to confirm), `docs/ws-gateway.md`.
