// packages/mobile/src/design/components/Button.tsx
// Carbon button: primary = solid blue fill, secondary = outlined, ghost = text only, danger = red
// fill (used for "Submit MAYDAY", flows.md B.13). 48px minimum touch target (DESIGN.md).
//
// A `loading` button renders a spinner and is disabled — the state-handling matrix (flows.md §D)
// requires "primary button shows spinner, disabled" while a write is in flight.

import React from "react";
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  label?: string;
  /** `children` accepted as an alias for `label` (used by screen code). */
  children?: React.ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading element (icon). Kept as a node so the icon set stays swappable. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Overrides the a11y label when the visible label is not descriptive enough. */
  accessibilityLabel?: string;
}

function palette(variant: ButtonVariant, disabled: boolean) {
  if (disabled) {
    return { bg: colors.surfaceContainerHigh, fg: colors.outline, border: "transparent" };
  }
  switch (variant) {
    case "primary":
      return { bg: colors.primary, fg: colors.onPrimary, border: "transparent" };
    case "danger":
      return { bg: colors.error, fg: colors.onError, border: "transparent" };
    case "secondary":
      return { bg: "transparent", fg: colors.primary, border: colors.outline };
    case "ghost":
      return { bg: "transparent", fg: colors.primary, border: "transparent" };
  }
}

export function Button({
  label,
  children,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  fullWidth = true,
  testID,
  style,
  accessibilityLabel,
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled || loading;
  const p = palette(variant, isDisabled);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? (label ?? (typeof children === "string" ? children : undefined))}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && variant === "primary" ? colors.primaryPressed : p.bg,
          borderColor: p.border,
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth * 2 : 0,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          opacity: pressed && !isDisabled ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text variant="bodyStrong" color={p.fg}>
            {label ?? (typeof children === "string" ? children : "")}
          </Text>
          {typeof children !== "string" ? children : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizing.buttonHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.none, // Carbon squared edges
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  icon: { marginRight: spacing.xs },
});
