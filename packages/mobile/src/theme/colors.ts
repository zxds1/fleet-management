/**
 * Carbon Enterprise System — semantic color palette.
 *
 * Light backgrounds (#ffffff canvas), IBM Blue (#0f62fe) primary,
 * #161616 text. Mirrors the token set defined in:
 * docs/apps/screens/stitch_fleetflow_mobile_specifications/carbon/DESIGN.md
 */
export const colors = {
  // ---- Surfaces ----
  background: "#ffffff",
  surface: "#ffffff",
  surfaceContainer: "#f4f4f4",
  surfaceContainerLow: "#f4f4f4",
  surfaceContainerLowest: "#ffffff",
  surfaceDim: "#e0e0e0",
  onBackground: "#161616",
  onSurface: "#161616",
  onSurfaceVariant: "#525252",
  secondary: "#6f6f6f",

  // ---- Outline / Border ----
  outline: "#8d8d8d",
  outlineVariant: "#e0e0e0",

  // ---- Primary (IBM Blue) ----
  primary: "#0f62fe",
  onPrimary: "#ffffff",
  primaryContainer: "#d0e2ff",
  primaryFixedDim: "#78a9ff",
  onPrimaryFixed: "#001d6c",
  onPrimaryFixedVariant: "#0043ce",

  // ---- Semantic status ----
  error: "#da1e28",
  onError: "#ffffff",
  errorContainer: "#fff1f1",
  onErrorContainer: "#750e13",
  tertiary: "#198038",
  onTertiary: "#ffffff",
  tertiaryContainer: "#a7f0ba",
  warning: "#FBBF24",
  info: "#60a5fa",

  // ---- Vehicle display-state colors (mirror backend precedence) ----
  stateQuarantined: "#da1e28",
  stateOffline: "#6B7280",
  stateHosAlert: "#FB923C",
  stateSpeeding: "#FACC15",
  stateMoving: "#198038",
  stateIdling: "#38BDF8",
  stateParked: "#94A3B8",

  // ---- Convenience aliases (map to semantic status tokens) ----
  statusSafe: "#198038",
  statusWarning: "#FBBF24",
  statusDanger: "#da1e28",
  statusInfo: "#60a5fa",

  white: "#FFFFFF",
  transparent: "transparent",
} as const;

export type AppColors = typeof colors;

/** Maps a VehicleDisplayState name to its marker/status color. */
export function displayStateColor(state: string): string {
  switch (state) {
    case "QUARANTINED":
      return colors.stateQuarantined;
    case "OFFLINE":
      return colors.stateOffline;
    case "HOS_ALERT":
      return colors.stateHosAlert;
    case "SPEEDING":
      return colors.stateSpeeding;
    case "MOVING":
      return colors.stateMoving;
    case "IDLING":
      return colors.stateIdling;
    case "PARKED":
    default:
      return colors.stateParked;
  }
}

export const radius = {
  sm: 0,
  md: 0,
  lg: 0,
  xl: 0,
  pill: 0,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;
