import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../theme";

/** Full-width primary action button — 48px min, squared, IBM Blue fill. */
export function FleetButton({
  text,
  onPress,
  enabled = true,
  isPrimary = true,
  style,
  testID,
}: {
  text: string;
  onPress: () => void;
  enabled?: boolean;
  isPrimary?: boolean;
  style?: any;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      testID={testID}
      style={[
        styles.btn,
        {
          backgroundColor: isPrimary ? colors.primary : colors.surface,
          opacity: enabled ? 1 : 0.5,
        },
        isPrimary ? null : styles.secondaryBtn,
        style,
      ]}
    >
      <Text style={[styles.label, { color: isPrimary ? colors.onPrimary : colors.primary }]}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 0,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  label: {
    fontFamily: typography.bodyMedium.fontFamily,
    fontWeight: "600",
    fontSize: 14,
    color: colors.onPrimary,
  },
});
