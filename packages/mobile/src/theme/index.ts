import { colors, radius, spacing } from "./colors";
import { typography } from "./typography";

export * from "./colors";
export * from "./typography";

/** Global theme object (mirrors FleetPulseTheme in Theme.kt). */
export const theme = {
  colors,
  radius,
  spacing,
  typography,
} as const;

export type AppTheme = typeof theme;

