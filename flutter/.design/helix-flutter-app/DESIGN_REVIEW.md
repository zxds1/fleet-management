# Design Review: Helix Flutter App (pre-build gate)

Reviewed against: `DESIGN_BRIEF.md`, `INFORMATION_ARCHITECTURE.md`, `DESIGN_TOKENS.md`,
`SCREEN_DESIGNS.md`, `MOTION.md`. Concept: "Field Instrument". Date: 2026-10-14.
**Screenshot status: not yet possible — no app exists.** The visual (rendered) portion of the
`design-review` skill runs after the Flutter build on an emulator (driver + admin shells, phone 375dp /
small 360dp / wide ≥1024dp, all four screen states); this pass is the artifact + countable gate.

## Summary

The system is coherent and ships with computed contrast, a locked type system, and motion restraint.
The biggest risk it must survive is the **original D-01 complaint ("looks like a prototype")** — warm
bone + ink can read paper-thin unless the strands, signage type, mono numerals, and navy brand moments
carry the craft. Second risk: a bright cyan primary button at ~10% area is unusual; it is locked to
primary buttons and small indicators only. Both are recorded as verification items, not blockers.

## Gate results

### ui-ux-kit Step 4.5 — adversarial review

1. **Concept test** (cover the brand): could this be any competitor? No — twin-strand shell identity
   tied to the actual Helix logo, signage-condensed display type, mono data numerals, and status-as-
   only-saturated-colour are specific to this product and its field context. **Pass.**
2. **Reflex test**: palette not guessable from "logistics" (navy+orange reflex refused; bone/ink +
   logo strands); type is not the Inter/Roboto reflex (Barlow Semi Condensed + IBM Plex Mono chosen for
   signage heritage). **Pass** — with one watch item below.
3. **Reference test**: each screen names its moves (instrument-panel glanceability, paper checklist
   forms, transit signage, Linear-grade state craft). **Pass.**
4. **One real weakness**: the **cyan primary button with ink text** (7.37:1, verified) is a rare
   pattern; at full width on small phones a bright cyan bar can vibrate against bone. Mitigation
   applied: cyan is capped (primary buttons + ≤24dp indicators only; headers/sheets/bars stay bone or
   navy), and `accent-text #0E7490` carries text/links/rings. **Flag for visual verification.**

### ui-ux-kit countable gate (mobile-adapted)

- Hard bans: no gradients on data, no glass, no sparkle/AI icons, no emoji icons, no library default
  theme (Material 3 re-themed explicitly), no shadow elevation on data surfaces, no nested cards,
  no clipped text (1.3× clamp + wrap rules), no hover-only or gesture-only interactions (hold has a
  two-step fallback; sheets have close buttons). **0 hits.**
- Countable limits: one primary CTA style per shell ✓; one label per CTA intent ✓; touch targets
  56/64 ✓; body ≥16dp ✓; every data view has loaded/loading/empty/error ✓; motion = 6 gated
  moments only (MOTION.md) ✓; contrast computed in both palettes ✓.
- **Icon family was unspecified — fixed in this review**: locked to **Material Symbols Rounded**,
  24dp, one family everywhere (was the one mixed-family risk).

### design-review checklist (artifact pass)

- Visual hierarchy: defined per screen (Home, Review, Map) with first/second/third priority rationale. ✓
- Consistency: all values single-sourced to tokens; admin/driver scale split documented. ✓
- Component quality: Expo inventory ported + Flutter-idiom additions (rail, sheets); no duplicates. ✓
- States/interactions: four states on every view; press/focus/disabled designed. ✓
- Responsive: phone-first for both shells; rail is enhancement. ✓
- Accessibility: AA computed (all pairs), status never colour-alone, reduced-motion, Dynamic Type clamp,
  screenshot blocking, live regions. ✓ (screen-reader labelling is an implementation verification item)
- Typography: one scale, body ≥16, mono for numerals. ✓
- Dark mode: deliberately deferred (field glare) with full dark tokens defined — deviation recorded. ✓
- Mobile-first: yes; no desktop dependency. ✓

### frontend-design-review pillars

1. **Frictionless insight→action**: clock-in ≤4 inputs with pre-checks; one primary action per screen;
   back/restore rules defined. **Pass.**
2. **Quality craft**: tokens not literals; computed contrast; distinctive type; intentional motion. **Pass.**
3. **Trustworthy building**: every error maps to a catalogue message + exactly one action; queued/offline
   states are honest (never fabricate "sent"). **Pass.**

## Must Fix (applied before implementation)

1. **Icon family locked**: Material Symbols Rounded, 24dp, one family — recorded in DESIGN_TOKENS.md §4.
2. **Strand discipline**: strand colours ≤10% of any screen; headers/bars/sheets stay bone or navy;
   `accent-text`/`admin-accent` carry all text/ring usage.
3. **Hold-to-confirm ceremony ceiling**: exactly two patterns (Mayday 2s; destructive confirms), each
   with a labelled non-gesture fallback — no third ceremony anywhere.
4. **Visual verification scheduled**: post-build emulator screenshots of both shells (driver Home /
   Clock-in / Refuel; admin Overview / Map / Review detail), 360/375/≥1024dp, all four states.

## Should Fix (during implementation)

- Odometer/money/decimal input: comma-decimal parsing + correct keyboards per field type (B4).
- Outbox status chip transitions: no animation (MOTION.md) — verify no shimmer on 5s polls.
- Splash on warm start: skip the logo fade entirely (first-run only).
- Admin Overview "at least" bounds: keep the exact-vs-bound distinction visible in the a11y label.

## Could Improve (post-v1)

- Dark ("Night Ops") palette for admin night-dispatch use.
- Swahili native-speaker copy review (D-02) — keys ported, language unreviewed.
- Iconography pass for status glyphs (✕ ○ ! ▲ ► ❚❚ P) in Material Symbols terms.

## What Works Well

- The twin-strand shell identity: distinctive, brand-true (it *is* the logo), and it makes the
  single-app/two-shell architecture visible in the UI itself.
- Computed-first colour: no pair in the system ships on vibes.
- Motion restraint: six gated moments, every one tied to feedback or continuity — the hold-to-confirm
  is the only safety-carrying animation and it has a fallback.

---

## Build verification (re-verified 2026-10-21)

- `flutter analyze` — **No issues found** (0 errors, 0 warnings, 0 infos).
- `flutter test` — **73/73 pass** across eight suites:
  - `errors_test.dart` — the catalogue, one-action contract, classification
  - `policy_format_test.dart` — single-sourced policy numbers, comma decimals, EAT ISO dates, v4 uuids
  - `security_test.dart` — fail-closed verdicts, deep-link/UUID validation parity with notification taps
  - `components_test.dart` — strand colours, status glyph+word, reduced-motion two-step confirm,
    the 200% body / 130% chrome text-scale ceilings, busy-state button
  - `queue_test.dart`, `integration_test.dart`, `design_preview_test.dart` — queue semantics,
    idempotent replay, 401 replay, media budget
  - `widget_test.dart` — the route table, the shell-access redirect, the Helix theme being applied,
    the admin strand re-theming, and the light/dark contrast pairs
  - `session_pin_test.dart` — the offline PIN verifier (salt, work factor, lockout, wipe)
- Full graph compile: `flutter analyze` type-checks the entire tree, including
  `app.dart → router.dart → shells.dart → all 50 screen files` (~14k lines of Dart).

### The 2026-10-14 verification was unsound

The 2026-10-14 pass reported a clean analyze and 26/26 tests, but the tree it measured was not
the shipping app: `main.dart` was still the Flutter counter demo, `router.dart` did not exist,
`HelixApp` was unreferenced, and `test/widget_test.dart` asserted the counter's "0" button. The
screen layer type-checked; the app did not run. See `docs/FLUTTER-REVIEW-2026-10-19.md`.

### Not verified here (environment limits, not code gaps)

- **Android/iOS binaries**: `/opt/android-sdk` has build-tools but no platforms and no cmdline-tools
  (the legacy `android`/`sdkmanager` tools crash under JDK 27), and there is no macOS for iOS.
  Run `flutter build apk --debug` / `flutter build ios` on a machine with a complete toolchain.
- **Device-only behaviour** (camera, GPS, biometrics, secure-store, screenshot blocking, socket
  connect) needs a real device — same Phase-4 script the Expo app still owes (D-08).
- **Rendered-screenshot review** of both shells (driver Home/Clock-in/Refuel, admin Overview/Map/
  Review) is still scheduled; attach to the first emulator screenshot pass.
- **Google Maps key**: the map renders with the default marker set until a Maps SDK key is supplied
  in `android/app/src/main/AndroidManifest.xml` + `AppDelegate` (open item P-10).

### Known functional simplifications shipped (tracked, not silent)

- Tracker pairing accepts **manual 15-digit IMEI** entry (now regex-validated against the server's
  `^\d{15}$`); QR scan is a post-MVP addition.
- Vehicle create/edit uses list + form flows; the vehicle **detail/edit** flow now exists against
  `GET /vehicles/:id` and `PATCH /vehicles/:id`.
- Root/jailbreak detection policy is implemented and tested (`core/security.dart`); the platform
  probe (jail-monkey equivalent) is the remaining native wiring, so `AuthStatus.blocked` is still
  unreachable in a shipped build.
- Certificate pinning is declared in `Config` but not enforced; `securityVerdict()` is not called
  from production code. See `docs/FLUTTER-REVIEW-2026-10-19.md` §8.
