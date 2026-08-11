// packages/mobile/src/design/theme.ts
// Theme surface consumed by every component. Kept intentionally small: the designs are a single
// light Carbon theme (`<html class="light">` in every supplied screen), so there is no runtime
// theme switching — only a device-form-factor split (phone driver vs tablet admin, D-1/D-2).

import { Dimensions, Platform, type TextStyle } from "react-native";
import {
  a11y,
  colors,
  displayStateColors,
  elevation,
  radius,
  sizing,
  spacing,
  spacingByIndex,
  textStyles,
  typography,
  type DisplayState,
} from "./tokens";

export interface Theme {
  colors: typeof colors;
  spacing: typeof spacingByIndex;
  space: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  textStyle: typeof textStyles;
  elevation: typeof elevation;
  sizing: typeof sizing;
  a11y: typeof a11y;
  displayStateColors: typeof displayStateColors;
  /** True on tablets — the admin shell uses the side navigation above this width (flows.md A.6). */
  isTablet: boolean;
}

export function isTabletLayout(width = Dimensions.get("window").width): boolean {
  return width >= sizing.tabletBreakpoint;
}

export const theme: Theme = {
  colors,
  spacing: spacingByIndex,
  space: spacing,
  radius,
  typography,
  textStyle: textStyles,
  elevation,
  sizing,
  a11y,
  displayStateColors,
  isTablet: isTabletLayout(),
};

/** Builds a `TextStyle` from a typography token, applying the platform font family. */
export function textStyle(
  token: keyof typeof typography extends infer K ? Exclude<K, "fontFamily"> : never,
  color: string = colors.onSurface,
): TextStyle {
  const t = typography[token as Exclude<keyof typeof typography, "fontFamily">];
  return {
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    fontWeight: t.fontWeight,
    color,
    // IBM Plex Sans is loaded via expo-font in App.tsx; on Android the weight must be carried by
    // the family name, on iOS `fontWeight` is honoured directly.
    ...(Platform.OS === "android"
      ? { fontFamily: t.fontWeight === "600" ? typography.fontFamily.semibold : typography.fontFamily.regular }
      : { fontFamily: typography.fontFamily.regular }),
  };
}

/** Colour triple for a vehicle/asset display state, following N5 precedence semantics. */
export function displayStateStyle(state: DisplayState) {
  return displayStateColors[state];
}
