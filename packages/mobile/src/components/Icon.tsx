import React from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { colors } from "../theme";

/** Thin wrapper so every screen references the same icon set — Carbon uses Material Symbols. */
export function Icon({
  name,
  size = 22,
  color = colors.onSurface,
}: {
  name: keyof typeof MaterialIcons.glyphMap;
  size?: number;
  color?: string;
}) {
  return <MaterialIcons name={name} size={size} color={color} />;
}
