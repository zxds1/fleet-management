import { TextStyle } from "react-native";

export const IBM_PLEX_SANS = "IBM Plex Sans";

export const typography = {
  headlineLarge: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "300",
    fontSize: 32,
    lineHeight: 40,
  } as TextStyle,
  headlineMedium: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 28,
    lineHeight: 36,
  } as TextStyle,
  headlineSmall: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 20,
    lineHeight: 28,
  } as TextStyle,
  titleLarge: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 22,
    lineHeight: 28,
  } as TextStyle,
  titleMedium: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 18,
    lineHeight: 24,
  } as TextStyle,
  titleSmall: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 16,
    lineHeight: 20,
  } as TextStyle,
  bodyLarge: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "400",
    fontSize: 14,
    lineHeight: 20,
  } as TextStyle,
  bodyMedium: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "400",
    fontSize: 14,
    lineHeight: 20,
  } as TextStyle,
  bodySmall: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "400",
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,
  labelLarge: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,
  labelMedium: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,
  labelSmall: {
    fontFamily: IBM_PLEX_SANS,
    fontWeight: "600",
    fontSize: 10,
    lineHeight: 14,
  } as TextStyle,
} as const;

export type Typography = typeof typography;

