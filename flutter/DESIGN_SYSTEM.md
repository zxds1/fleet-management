# DESIGN_SYSTEM.md — Helix

The single source of truth for how Helix looks and behaves. Every future page,
section and component reuses the values here. If something changes, this file
changes in the same commit.

**Surface profile (Step 1):** Mobile / Native — two shells (driver, admin) in
one Flutter app, plus a shared document layer. Dashboard/admin density rules
apply to the admin shell only.

**Design personality / concept (Step 2.7):** *"A precision field instrument."*
Dieter Rams functionalism read as an aviation instrument panel — warm bone/ink
paper instead of clinical white, signage display type for anything the driver
reads at a glance, hairline rules instead of boxes, tabular mono numerals
instead of a sea of left-aligned digits, and status colour as the only
saturated thing on a data surface. The twin-strand logo is the brand: cyan is
the driver, violet is the admin, and the two never appear in the same shell.

**Not:** a purple gradient, a glassy dashboard, a card-in-card-in-card layout,
a stock Material chip, or a status encoded in colour alone.

---

## 1. Project overview

| | |
|---|---|
| Product | Fleet & logistics operations — driver and admin in one app |
| Platform | Flutter (Android first, iOS Phase 2 per locked decision A3.4) |
| Shells | `Shell.driver` (cyan) · `Shell.admin` (violet) |
| Locales | English (default) + Swahili. Every user-facing string exists in both. |
| Dark mode | Shipped. "Daylight Field" (light) / "Night Ops" (dark). |
| Source of truth | `lib/design/tokens.dart` (values) · `lib/design/theme.dart` (theme) · `lib/design/motion.dart` (physics) |

---

## 2. Brand direction

- **Field Instrument.** Warm paper surfaces, ink type, hairline rules, one
  saturated accent per shell, everything else tonal.
- **Driver = cyan `#06B6D4`.** The active-strand colour, the Mayday-adjacent
  energy, the "in the field" half of the business.
- **Admin = violet `#6D28D9`.** The oversight half: denser, more analytical,
  never as loud.
- **Brand navy `#0F172A`** is the logo's ground and the inverse surface. It
  never flips with the theme.

---

## 3. Color system

Two immutable palettes, one per brightness. **The dark palette is derived, not
inverted** — the light accent-text tone is unreadable on graphite, so the dark
palette carries its own. Every text pair below was contrast-checked against
its own surface; the pairs are asserted in `test/widget_test.dart` in **both**
palettes, so a future token change that breaks one fails the build.

### Light — "Daylight Field"

| Token | Value | Use |
|---|---|---|
| `bg` | `#F6F3EC` | Page ground |
| `surface` | `#FDFCF7` | Cards, bars |
| `surfaceSunk` | `#EFEBE1` | Input wells, chips |
| `surfaceInverse` | `#0F172A` | Inverse surfaces (toast, snackbar) |
| `text` | `#191713` | Body, headings |
| `textSecondary` | `#57503F` | Supporting copy |
| `textTertiary` | `#6E6759` | Placeholders, disabled — never essential copy |
| `textInverse` | `#F6F3EC` | On inverse surfaces |
| `line` | `#D8D2C4` | Hairlines, dividers |
| `lineStrong` | `#8C8266` | Input outlines (3.2:1 on `surfaceSunk`) |
| `accent` | `#06B6D4` | Driver strand **fill** only |
| `accentText` | `#0E7490` | Driver strand as text/icon (4.8:1) |
| `accentQuiet` | `#DFF3F8` | Selected / quiet fill |
| `onAccent` | `#191713` | Label on the driver fill (7.4:1) |
| `adminAccent` | `#6D28D9` | Admin strand **fill** |
| `adminAccentQuiet` | `#EEE9FD` | Admin quiet fill |
| `onAdminAccent` | `#FFFFFF` | Label on the admin fill (7.1:1) |
| `statusOk` `statusDanger` `statusWarn` `statusInfo` `statusNeutral` `statusPlum` `statusAmber` `statusOlive` | `#166B3F` `#9E2B1F` `#8A5A00` `#2A5EA8` `#5C6468` `#7A1F5C` `#A85500` `#7A6100` | Status — always with a glyph **and** a word |

### Dark — "Night Ops"

`bg #141310` · `surface #211F19` · `surfaceSunk #0C0B09` · `text #ECE9E0` ·
`textSecondary #A8A394` · `textTertiary #948D7E` · `line #3A372E` ·
`lineStrong #847C6D` · `accent #22D3EE` · `accentText #22D3EE` ·
`accentQuiet #1B2A30` · `onAccent #141310` · `adminAccent #A78BFA` ·
`adminAccentQuiet #2A1F42` · `onAdminAccent #141310` · status colours
lightened per tone (`ok #5CB87E`, `danger #E0776A`, `warn #D9A22E`,
`info #7FA8E8`, `neutral #8A9189`, `plum #C98CAC`, `amber #F0A03E`,
`olive #C4A45B`).

**Rules**
- The raw strand fill is never a text or icon colour — use `accentText` /
  `adminAccent`.
- Status is never colour alone: glyph + word, always.
- Elevation is a tone step, never a shadow.
- 60 / 30 / 10: paper grounds, tonal surfaces, one accent.

---

## 4. Typography system

| Role | Face | Size (driver / admin) |
|---|---|---|
| Display | Barlow Semi Condensed 700 | 30 / 36 |
| Title | Barlow Semi Condensed 700 | 24 / 28 |
| Lead | Barlow 600 | 19 / 22 |
| Body | Barlow 400 | 16 / 17 |
| Caption | Barlow 500 | 13 / 14 |
| Numerals | IBM Plex Mono 500, tabular | on the caption/body step |

- Line height: 1.5 body, 1.1–1.2 display, 1.35–1.4 caption.
- Tracking: −0.015 on display and title, 0 on body, slightly positive on
  small caps labels.
- **Never an inline font size.** Use `TypeScale.*`; the only sanctioned
  exception is `TypeScale.numeral` for chrome numerals.
- **Text scale:** body copy honours the platform setting up to **200 %**
  (WCAG 1.4.4). Copy inside fixed-height controls uses `HelixText.chrome`,
  which clamps to 130 %.

---

## 5. Layout system

- Gutter 16 (driver) / 24 (admin). Card padding 16 / 20.
- Radius: control 8, card 12, sheet 16 (admin 12 / 24), full 999.
- Touch targets: 56 (driver) / 64 (admin) for controls; 48 minimum for an
  interactive chip; 32 for a non-interactive badge.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- One `Screen` scaffold per screen: scroll, pull-to-refresh, safe-area
  aware, optional offline tag. Two shells, each a bottom-tab bar.

---

## 6. Component system

| Component | File | Notes |
|---|---|---|
| `StrandButton` / `QuietButton` / `DangerButton` | `components/buttons.dart` | Full state set: default, hover, focus-visible, pressed, disabled, busy |
| `HelixCard` / `Section` / `KeyValueRow` | `components/card.dart` | Selection changes the fill, not a border |
| `Field` | `components/field.dart` | Label above, blur validation, error below, visible required marker, focus ring as an overlay |
| `Segmented` | `components/segmented.dart` | Radio group, exact counts only |
| `StatusBadge` / `HelixChip` | `components/status_badge.dart` | Glyph + word |
| `GaugePicker` / `GaugeBar` | `components/gauge_picker.dart` | 5-position radiogroup; the bar's colour carries the level |
| `PagedList` | `components/paged_list.dart` | Cursor paging; every state recoverable |
| `EmptyState` / `ErrorState` | `components/states.dart` | The error state always offers a retry; RATE_LIMITED counts down |
| `Skeleton` | `components/skeleton.dart` | Opacity sweep; static under reduced motion |
| `Toast` / `OfflineBanner` | `components/banners.dart` | 4 s toast; the offline banner is always honest |
| `FormShell` | `components/form_shell.dart` | Queued / sent / error banner |
| `SheetHost` | `components/sheet_host.dart` | Drag handle, drag-to-dismiss, close button |
| `SwipeActionRow` | `components/swipe_row.dart` | Every action also has a visible tap fallback |
| `HoldToConfirm` | `components/hold_to_confirm.dart` | Mayday and destructive confirms; two-step fallback |
| `PhotoCapture` | `components/photo_capture.dart` | Permission-aware, honest failure |
| `MediaThumb` | `components/media_thumb.dart` | Presigned media |
| `PrivacyShield` | `components/privacy_shield.dart` | Screenshot + app-switcher protection, **no watermark** |
| `HelixLogo` | `helix_logo.dart` | The brand moment |

---

## 7. Card & section style

- Surface fill + a 1 px hairline. Never a shadow.
- One depth hierarchy: page base → raised surface → floating element.
- **No nested elevated surfaces.**
- Sections: a lead-weight header, optional subtitle, one grouped container,
  hairline separators between rows.

---

## 8. Icon system

**Material Icons Rounded, 24 dp, one family everywhere.** The Flutter
convention is the `_rounded` suffix (`Icons.home_rounded`). Never
`Icons.rounded.*` — that nested class does not exist. Never a second family,
never an emoji as a structural icon.

---

## 9. Brand assets

The brand has **one** source: `assets/brand/helix_source.png`. Everything else
is generated from it by `tool/generate_brand_assets.py`, so the launcher icon,
the iOS icon and the in-app mark can never drift apart.

| Output | Shape | Used by |
|---|---|---|
| `assets/brand/helix_mark.png` | the mark, transparent | the in-app logo tile, the privacy badge |
| `assets/brand/helix_badge_circle.png` | a round navy badge | compact brand spots |
| `assets/brand/helix_splash.png` | the mark on the brand navy | the launch screen |
| `mipmap-*/ic_launcher.png` | a rounded square | the legacy launcher icon |
| `mipmap-*/ic_launcher_foreground.png` + `ic_launcher.xml` | an adaptive layer inside the safe zone | the launcher, which masks it to the device's own shape |
| `ios/…/AppIcon.appiconset` | a full-bleed square | iOS masks the corners itself |

Rules:

- **Never hand-draw the logo.** The old `CustomPainter` strands were a
  different, weaker mark with two identical paths; the artwork is now the
  mark.
- **Shape follows the use case.** A squircle tile in the app, a circle where
  the mark is a compact spot, a launcher-masked adaptive layer, a full-bleed
  square for iOS.
- The wordmark and the "LTD" line are **not** part of the mark. The product
  name is set in Barlow in the app, from the type scale.
- Regenerate with `python3 tool/generate_brand_assets.py` after replacing the
  source.

## 10. Maps

- The map is **not** the Google Maps SDK. It is `flutter_map` over raster
  tiles, so it works with **no API key**.
- The tile source is a build input: `--dart-define=MAP_TILE_URL=…`. The
  default is the OpenStreetMap public tiles, with the attribution their
  usage policy requires.
- **A marker carries the product's status colour**, not a third-party hue,
  and it is a word plus a colour — never colour alone.
- The map is a view. The fleet list carries the same information and is what
  an admin reads when the tiles cannot load.

## 11. Image & asset rules

- Photography is only ever evidence: accident photos, DVIR item photos, fuel
  receipts. It is re-encoded to JPEG, 1080 px, ≤ 500 KB, which also strips
  EXIF (including GPS).
- `MediaThumb` always carries an alt label.
- No decorative imagery in the product surfaces.

---

## 11. Animation & interaction system

- **Springs for anything the user can touch.** Default: critically damped
  (`ratio 1.0`, ~0.35 s). Under-damped (`ratio 0.8`) only for a gesture that
  carried momentum — a flick, a throw, a release.
- **Velocity handoff.** A release continues at the finger's velocity. The
  animated value runs *opposite* to the pixel axis in a sheet and a swipe row,
  so the handoff inverts the sign and divides by the pixels one unit of value
  spans.
- **Interruptible.** Every animation starts from its live on-screen value, so
  it can be retargeted mid-flight without a velocity discontinuity.
- Motion is motivated: it communicates hierarchy, feedback, continuity or
  state. If it cannot be named in one sentence, it is cut.
- Only `transform` and `opacity` animate. A fill change **snaps**.
- Reduced motion: `MediaQuery.disableAnimationsOf(context)` → cross-fade or
  instant, and never a gesture-only path.

---

## 12. Accessibility rules

- Body text ≥ 4.5:1; large text and graphical elements ≥ 3:1; input outlines
  ≥ 3:1 on their own field surface. Verified by computation, not by eye.
- Every interactive element ships default / hover / **focus-visible** /
  pressed / disabled. The ring appears for keyboard focus only.
- Every control is keyboard reachable and activates on Enter/Space.
- Status is never colour alone; colour is never the only signal.
- Touch targets: 48 dp minimum for anything interactive.
- Live regions for outcomes that arrive without a gesture: error banners, the
  PIN announcement, toasts.
- No gesture-only interaction. Swipe and hold always have a tap fallback.

---

## 13. Anti-AI-slop rules

Banned in this product, and checked in review:

- The default purple / blue-purple gradient, and raw `#000`/`#fff` by default.
- Gradient text, decorative glass, side-stripe accents.
- Mixed icon families; emoji as structural icons.
- A static interactive element; a silent async action; a blank
  empty/loading/error screen.
- An inline font size outside the scale; a colour outside the palette.
- Borders used as the primary device for separating cards.
- Nested elevated surfaces; a card-in-card-in-card.
- A decorative sparkle / ✨ / ✦ in an eyebrow, badge or pill.
- A focus ring that flashes on a mouse click.
- A hardcoded user-facing English string.

---

## 14. Future page instructions

1. Start from `Screen` or `ScreenColumn`; do not hand-roll a scaffold.
2. Use `HelixText` with a `TypeScale` style. Chrome inside fixed-height
   controls uses `HelixText.chrome`.
3. Use the shell's strand: `Shell.driver` → `accentText`, `Shell.admin` →
   `adminAccent`. A shared screen takes the strand from its caller, never a
   hardcoded one.
4. Every list is a `PagedList`; every async action has loading, success and
   error states; every destructive action is a `HoldToConfirm` or a
   two-step confirm.
5. Every string goes through `context.s.t('key')` — and the key must exist in
   **both** `en.dart` and `sw.dart`. `Strings.t` asserts in debug when it does
   not.
6. New colours, sizes and spacings go into `tokens.dart` first, with a
   contrast check in both palettes.
7. Re-check the light and dark pairs and add the assertion to
   `test/widget_test.dart`.
8. **Render it.** Add the screen to `test/render_test.dart`: it must lay out
   at a phone and a tablet width, in both palettes, with no layout error and
   no unhandled exception. `flutter analyze` cannot see a layout overflow; the
   render suite can, and it is the only thing standing between a screen and a
   broken layout.

---

## 15. Update policy

This file and `lib/design/tokens.dart` change in the same commit. A token
change that alters a contrast pair must update the pair table here and the
assertion in `test/widget_test.dart` in that commit.

The full review, the findings and the remediation record live in
`fleet-management/docs/FLUTTER-REVIEW-2026-10-19.md`. The token specification
and the pre-flight gate live in
`flutter/.design/helix-flutter-app/DESIGN_TOKENS.md` and
`flutter/.design/helix-flutter-app/DESIGN_REVIEW.md`.
