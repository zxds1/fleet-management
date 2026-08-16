import { colors, radius, spacing } from "./colors";
import { commandColors } from "./commandColors";
import { typography } from "./typography";

export * from "./colors";
export * from "./commandColors";
export * from "./typography";

/** Global theme object (mirrors FleetPulseTheme in Theme.kt). */
export const theme = {
  colors,
  commandColors,
  radius,
  spacing,
  typography,
} as const;

export type AppTheme = typeof theme;

