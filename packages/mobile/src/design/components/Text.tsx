// packages/mobile/src/design/components/Text.tsx
// Typography primitive. Every user-facing string in the app renders through this component so the
// font scale, colour roles and the a11y font-scaling cap (tokens.a11y.maxFontSizeMultiplier) are
// applied uniformly. RN `Text` is XSS-safe by default (no DOM) — security.md §5.

import React from "react";
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { a11y, colors, typography, textStyles } from "../tokens";

// IBM Plex Sans is the single sanctioned family (DESIGN.md). On Android the weight must be
// carried by the family name (IBMPlexSans-SemiBold), on iOS `fontWeight` is honoured directly.
// The font files are registered in `App.tsx` via expo-font; if absent the OS falls back
// gracefully rather than crashing.
function familyFor(weight: TextStyle["fontWeight"]): string {
  if (Platform.OS === "android" && weight === "600") return "IBMPlexSans-SemiBold";
  if (Platform.OS === "android" && weight === "300") return "IBMPlexSans-Light";
  return "IBMPlexSans-Regular";
}

/** Both the product-typography tokens and the Carbon type-style aliases (`heading01`, `body01`, …). */
export type TextVariant = keyof typeof typography | keyof typeof textStyles;

export interface TextProps extends RNTextProps {
  /** Typography token. `preset` is accepted as an alias (used by screen code). */
  variant?: TextVariant;
  preset?: TextVariant;
  /** `title` is accepted as an alias for `children` (used by screen code). */
  title?: string;
  color?: string;
  align?: TextStyle["textAlign"];
}

function resolveToken(variant: TextVariant): { fontSize: number; lineHeight: number; fontWeight: TextStyle["fontWeight"] } {
  if (variant in typography) {
    const t = typography[variant as keyof typeof typography];
    if (typeof t === "object" && "fontSize" in t) return t as { fontSize: number; lineHeight: number; fontWeight: TextStyle["fontWeight"] };
  }
  if (variant in textStyles) {
    return textStyles[variant as keyof typeof textStyles] as { fontSize: number; lineHeight: number; fontWeight: TextStyle["fontWeight"] };
  }
  return typography.body;
}

export function Text({
  variant,
  preset,
  title,
  color = colors.onSurface,
  align,
  style,
  children,
  ...rest
}: TextProps): React.ReactElement {
  const resolvedVariant = variant ?? preset ?? "body";
  const token = resolveToken(resolvedVariant);
  const content = children ?? title;
  return (
    <RNText
      maxFontSizeMultiplier={a11y.maxFontSizeMultiplier}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          fontWeight: token.fontWeight,
          fontFamily: familyFor(token.fontWeight),
          color,
          ...(align ? { textAlign: align } : {}),
        },
        style,
      ]}
      {...rest}
    >
      {content}
    </RNText>
  );
}
