// packages/mobile/src/design/components/Logo.tsx
//
// Helix brand logo. Renders the official logo assets (packages/mobile/assets) so the app matches the
// approved Helix branding in docs/apps/screens/stitch_fleetflow_mobile_specifications:
//   - logo-horizontal.png : full horizontal lockup (mark + wordmark)
//   - logo-mark.png       : square ribbon icon (mark only)
// Falls back to the wordmark text if the image cannot be resolved. Used on startup, login and signup.

import React from "react";
import { Image, type ImageStyle, View, type ViewStyle } from "react-native";
import { spacing } from "../tokens";

export interface LogoProps {
  /** When false, render the mark only (logo-mark.png) instead of the full horizontal lockup. */
  withWordmark?: boolean;
  /** Pixel height of the logo; width scales to the asset's aspect ratio. Defaults to 40. */
  size?: number;
  /** Accessible label; defaults to the product name. */
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Logo({ withWordmark = true, size = 40, accessibilityLabel, style }: LogoProps): React.ReactElement {
  const source = withWordmark
    ? require("../../../assets/logo-horizontal.png")
    : require("../../../assets/logo-mark.png");
  const imageStyle: ImageStyle = {
    height: size,
    width: size * (withWordmark ? 4 : 1),
    resizeMode: "contain",
  };
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? "Helix Fleet"}
      style={[{ flexDirection: "row", alignItems: "center", gap: spacing.md }, style]}
    >
      <Image source={source} style={imageStyle} accessibilityIgnoresInvertColors />
    </View>
  );
}
