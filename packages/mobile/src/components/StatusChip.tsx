import React from "react";
import { Text, StyleSheet } from "react-native";
import { colors } from "../theme";

export type StatusVariant = "filled" | "outlined" | "subtle";

/**
 * Carbon-styled status chip. Renders as outlined (default) or filled
 * depending on severity. For neutral/informational chips uses the
 * `subtle` variant — light gray bg with colored text.
 */
export function StatusChip({
  text,
  color,
  style,
  variant = "outlined",
}: {
  text: string;
  color: string;
  style?: any;
  variant?: StatusVariant;
}) {
  return (
    <Text
      style={[
        chipStyle.base,
        variant === "filled"
          ? { backgroundColor: color + "1A", borderColor: color, color }
          : variant === "subtle"
          ? { backgroundColor: colors.surfaceDim, borderColor: colors.outlineVariant, color: colors.onSurfaceVariant }
          : { backgroundColor: colors.surface, borderColor: color, color },
        style,
      ]}
    >
      {text}
    </Text>
  );
}

const chipStyle = StyleSheet.create({
  base: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0,
    fontSize: 12,
    fontWeight: "500",
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
  },
});
