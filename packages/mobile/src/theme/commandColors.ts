import type { TextStyle } from "react-native";

export const commandColors = {
  canvas: "#0A0A0C",
  surface: "#121215",
  surfaceRaised: "#16161A",
  surfaceCritical: "#171315",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.16)",
  text: "#EAEAEA",
  textMuted: "#8D8D8D",
  textDim: "#73737B",
  blue: "#0F62FE",
  blueSoft: "#78A9FF",
  info: "#60A5FA",
  success: "#42BE65",
  successSoft: "#78D79A",
  warning: "#FBBF24",
  danger: "#DA1E28",
  dangerSoft: "#FF8389",
  parked: "#94949D",
  white: "#FFFFFF",
} as const;

export type CommandColors = typeof commandColors;

export const commandSpacing = {
  micro: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export const mono: TextStyle = {
  fontFamily: "monospace",
  fontVariant: ["tabular-nums"],
};
