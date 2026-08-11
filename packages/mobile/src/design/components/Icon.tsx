// packages/mobile/src/design/components/Icon.tsx
//
// Icon primitive. The screen designs specify Google "Material Symbols Outlined". The closest
// dependency-free vector set already present in the workspace is `@expo/vector-icons`
// (`MaterialIcons` + `Ionicons`), whose glyph names map almost 1:1 to the Material Symbols
// names used in the specs. We keep a curated name→(set,name) map so callers use the spec
// vocabulary (`menu`, `home`, `notifications`, …) and never touch a specific icon library.
//
// When a name is unknown it renders a safe 1x1 transparent view (no tofu/box), so a missing
// mapping degrades gracefully instead of breaking layout.

import React from "react";
import { View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, type IconName } from "../tokens";
import { iconSet, iconKey } from "../iconMap";

export type { IconName };

export interface IconProps {
  /** Material Symbols name from the spec vocabulary (see `tokens.ts` `IconName`). */
  name: IconName;
  size?: number;
  color?: string;
  /** Render the filled variant where the library supports it. */
  filled?: boolean;
  testID?: string;
}

export function Icon({ name, size = 24, color = colors.onSurface, filled = false, testID }: IconProps): React.ReactElement {
  const key = iconKey(name, filled);
  const resolved = iconSet[key] ?? iconSet[name];
  if (!resolved) {
    return <View testID={testID} style={{ width: size, height: size }} accessibilityElementsHidden />;
  }
  const { set, glyph } = resolved;
  if (set === "ionicons") {
    const Ionicons = require("@expo/vector-icons").Ionicons;
    return <Ionicons testID={testID} name={glyph as any} size={size} color={color} />;
  }
  return <MaterialIcons testID={testID} name={glyph as any} size={size} color={color} />;
}
