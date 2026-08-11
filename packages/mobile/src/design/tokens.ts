// packages/mobile/src/design/tokens.ts
//
// Design tokens distilled from the supplied screen designs
// (docs/apps/screens/stitch_fleetflow_mobile_specifications/**) and their `carbon/DESIGN.md`
// north star: "Productive Clarity" — IBM Carbon, IBM Plex Sans, squared corners, 8px grid,
// strictly semantic colour, WCAG AA contrast.
//
// The screens define STYLE only (docs/apps/IMPLEMENTATION-PROMPT.md §2); `flows.md` defines
// structure and behaviour. Nothing here encodes layout.

/** Raw Carbon-derived palette, taken verbatim from the tailwind config in the screen HTML. */
export const palette = {
  // Brand / interactive
  blue10: "#d0e2ff",
  blue40: "#78a9ff",
  blue60: "#0f62fe", // primary
  blue70: "#0043ce", // primary pressed / hover
  blue90: "#001d6c", // primary emphasis (driver "Clock In")

  // Neutral ramp (#f4f4f4 → #161616 per DESIGN.md)
  white: "#ffffff",
  gray10: "#f4f4f4",
  gray20: "#e0e0e0",
  gray30: "#c6c6c6",
  gray50: "#8d8d8d",
  gray60: "#6f6f6f",
  gray70: "#525252",
  gray80: "#393939",
  gray100: "#161616",

  // Semantic
  green50: "#42be65",
  green60: "#198038", // success / tertiary
  green20: "#a7f0ba",
  green90: "#044317",
  red10: "#fff1f1",
  red60: "#da1e28", // error / danger
  red90: "#750e13",
  yellow30: "#f1c21b", // warning (speeding)
  yellow10: "#fcf4d6",
  orange40: "#ff832b", // HOS alert
  orange10: "#fff2e8",
  purple60: "#8a3ffc",
  teal60: "#009d9a",
} as const;

/** Semantic colour roles. Components MUST use these, never `palette.*` directly. */
export const colors = {
  primary: palette.blue60,
  primaryPressed: palette.blue70,
  primaryEmphasis: palette.blue90,
  primaryContainer: palette.blue10,
  onPrimary: palette.white,
  onPrimaryContainer: palette.gray100,
  secondaryContainer: palette.gray20,
  onSecondaryContainer: palette.gray100,

  background: palette.gray10, // `bg-surface-container-low` body in the designs
  surface: palette.white,
  surfaceContainer: palette.gray10,
  surfaceContainerHigh: palette.gray20,
  surfaceContainerHighest: palette.gray30,
  surfaceContainerLowest: palette.white,
  inverseSurface: palette.gray80,

  onSurface: palette.gray100,
  onSurfaceVariant: palette.gray70,
  secondary: palette.gray60,
  outline: palette.gray50,
  outlineVariant: palette.gray20,

  success: palette.green60,
  successContainer: palette.green20,
  onSuccessContainer: palette.green90,

  warning: palette.yellow30,
  warningContainer: palette.yellow10,

  error: palette.red60,
  errorContainer: palette.red10,
  onErrorContainer: palette.red90,
  onError: palette.white,

  info: palette.blue60,
  infoContainer: palette.blue10,

  /** Overlay for bottom sheets / modals. */
  scrim: "rgba(22, 22, 22, 0.5)",

  // --- Carbon alias names used across components (kept alongside the Material-ish names above) ---
  ui01: palette.white,
  ui02: palette.gray10,
  ui03: palette.gray20,
  ui04: palette.gray30,
  ui05: palette.gray50,

  interactive01: palette.blue60,
  interactive02: palette.gray100,

  textPrimary: palette.gray100,
  textSecondary: palette.gray60,
  textOnColor: palette.white,
  textInverse: palette.white,

  supportError: palette.red60,
  supportErrorInverse: palette.white,
  supportErrorLight: palette.red10,
  supportWarning: palette.yellow30,
  supportWarningInverse: palette.gray100,
  supportWarningLight: palette.yellow10,
  supportSuccess: palette.green60,
  supportSuccessInverse: palette.white,
  supportSuccessLight: palette.green20,
  supportInfo: palette.blue60,
  supportInfoInverse: palette.white,
  supportInfoLight: palette.blue10,
} as const;

/**
 * Vehicle display-state colours, in N5 precedence order
 * (`QUARANTINED > OFFLINE > HOS_ALERT > SPEEDING > MOVING > IDLING > PARKED`, 08 §6).
 * The array order IS the precedence — `statusPrecedence` below depends on it.
 */
export const displayStateColors = {
  QUARANTINED: { fg: palette.white, bg: palette.red60, dot: palette.red60 },
  OFFLINE: { fg: palette.gray100, bg: palette.gray30, dot: palette.gray60 },
  HOS_ALERT: { fg: palette.white, bg: palette.orange40, dot: palette.orange40 },
  SPEEDING: { fg: palette.gray100, bg: palette.yellow30, dot: palette.yellow30 },
  MOVING: { fg: palette.white, bg: palette.green60, dot: palette.green60 },
  IDLING: { fg: palette.white, bg: palette.blue60, dot: palette.blue60 },
  PARKED: { fg: palette.gray100, bg: palette.gray20, dot: palette.gray60 },
} as const;

/** 8px grid (DESIGN.md "Follow 8px spacing grid strictly"), with a 2px/4px sub-step. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Numeric-index view of `spacing` for the common `spacing[5]` style access. */
export const spacingByIndex = [0, spacing.xxs, spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl] as const;

/** Carbon squared edges: 0 for containers, tiny radii only for chips/pills. */
export const radius = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 8,
  pill: 999,
} as const;

/** IBM Plex Sans with weight-driven hierarchy (300/400/600), body 14, label 12. */
export const typography = {
  fontFamily: {
    // The bundled font is registered in `theme.ts`; the system fallback keeps
    // the app renderable before fonts load.
    regular: "IBMPlexSans-Regular",
    semibold: "IBMPlexSans-SemiBold",
    light: "IBMPlexSans-Light",
  },
  display: { fontSize: 32, lineHeight: 40, fontWeight: "600" as const },
  headline: { fontSize: 28, lineHeight: 36, fontWeight: "600" as const },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" as const },
  subtitle: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  metric: { fontSize: 24, lineHeight: 32, fontWeight: "600" as const },
} as const;

/** Minimal elevation; the designs prefer a bottom border over a shadow. */
export const elevation = {
  none: {},
  level1: {
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  level2: {
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;

/** 48px minimum touch target (DESIGN.md "Buttons … 48px min touch target"). */
export const sizing = {
  minTouchTarget: 48,
  buttonHeight: 48,
  inputHeight: 48,
  bottomNavHeight: 56,
  topBarHeight: 56,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  /** Tablet breakpoint at which the admin shell switches to the side navigation (A.6). */
  tabletBreakpoint: 768,
} as const;

/** Accessibility budget — see IMPLEMENTATION-PROMPT §5.9 "a11y + large-text". */
export const a11y = {
  /** Cap OS font scaling so 200% text does not destroy the data-dense admin tables. */
  maxFontSizeMultiplier: 1.6,
  /** Minimum contrast target enforced by the palette above. */
  contrastTarget: "WCAG AA",
} as const;

export type DisplayState = keyof typeof displayStateColors;

/**
 * N5 precedence, highest first. `pickDisplayState` resolves a set of concurrently-true states
 * to the single one the chip must show.
 */
export const statusPrecedence: readonly DisplayState[] = [
  "QUARANTINED",
  "OFFLINE",
  "HOS_ALERT",
  "SPEEDING",
  "MOVING",
  "IDLING",
  "PARKED",
] as const;

/** Returns the highest-precedence state present, or `PARKED` when the input is empty (N5). */
export function pickDisplayState(states: readonly DisplayState[]): DisplayState {
  for (const candidate of statusPrecedence) {
    if (states.includes(candidate)) return candidate;
  }
  return "PARKED";
}

/**
 * Material Symbols vocabulary used across the screen designs. Screens reference these semantic
 * names via `<Icon name=… />`; the concrete glyph mapping lives in `iconMap.ts`. Keeping the
 * vocabulary here (instead of raw library names) means a screen never hardcodes an icon library.
 */
export type IconName =
  | "menu" | "close" | "arrow_back" | "arrow_forward" | "chevron_right" | "chevron_left"
  | "more_horiz" | "more_vert" | "search" | "filter_list" | "add" | "remove" | "check"
  | "check_circle" | "circle" | "radio_button_checked" | "radio_button_unchecked" | "error"
  | "warning" | "info" | "help" | "refresh" | "sync" | "edit" | "delete" | "upload_file"
  | "download" | "visibility" | "visibility_off" | "settings" | "logout" | "login"
  | "fingerprint" | "shield_person" | "gpp_good" | "verified_user" | "lock" | "qr_code_scanner"
  | "home" | "local_gas_station" | "fact_check" | "report_problem" | "support_agent" | "dashboard"
  | "directions_car" | "group" | "build" | "person" | "notifications" | "notifications_none"
  | "location_on" | "my_location" | "place" | "map" | "layers" | "route" | "pin_drop"
  | "swap_horiz" | "swap_vert" | "trailer_swap" | "rv_hookup" | "local_shipping" | "schedule"
  | "timer" | "power_settings_new" | "play_circle" | "menu_book" | "school" | "card_membership"
  | "badge" | "medical_services" | "call" | "mail" | "home_pin" | "id_card" | "camera"
  | "photo_camera" | "add_a_photo" | "image" | "videocam" | "attach_file" | "zoom_in"
  | "rotate_right" | "description" | "receipt_long" | "credit_card" | "gas_meter" | "speed"
  | "oil_barrel" | "water_drop" | "tire_repair" | "thermostat"   | "ev_station"
  | "battery_charging_full" | "bolt" | "gavel" | "warning_amber" | "error_outline"
  | "bar_chart" | "notifications_active" | "insights" | "rule" | "people" | "campaign"
  | "check_circle_outline" | "pending" | "pending_actions" | "assignment" | "assignment_late"
  | "assignment_turned_in" | "calendar_today" | "history" | "list" | "grid_view" | "view_list"
  | "expand_more" | "expand_less" | "keyboard_arrow_down" | "navigate_next" | "navigate_before"
  | "first_page" | "last_page" | "language" | "dark_mode" | "light_mode" | "wifi" | "wifi_off"
  | "cloud_off" | "cloud_done" | "cloud_upload" | "send" | "message" | "chat" | "phone"
  | "contact_support" | "help_outline" | "info_outline" | "star" | "bookmark" | "flag"
  | "bookmark_add" | "add_circle" | "add_circle_outline" | "remove_circle" | "restore"
  | "restart_alt" | "content_copy" | "print" | "download_for_offline" | "hub"
  | "medical_information" | "document_scanner" | "inventory_2" | "category" | "label"
  | "visibility_lock";

/** Carbon product-type styles referenced across components (body01, label01, heading02, …). */
export const textStyles = {
  body01: { ...typography.body, fontWeight: "400" as const },
  body02: { ...typography.body, fontWeight: "400" as const },
  bodyCompact01: { ...typography.caption, fontWeight: "400" as const },
  label01: { ...typography.label, fontWeight: "400" as const },
  label02: { ...typography.label, fontWeight: "600" as const },
  heading01: typography.subtitle,
  heading02: typography.title,
  heading03: typography.headline,
} as const;
