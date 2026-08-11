// packages/mobile/src/design/components/Input.tsx
// Carbon input: bottom-border style, grey fill, 48px height, 12px semibold label above.
// `error` renders the field-level message that `VALIDATION_ERROR.field_errors` maps to (08 §1).

import React, { useState } from "react";
import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { a11y, colors, radius, sizing, spacing, typography } from "../tokens";
import { Text } from "./Text";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label: string;
  /** Localized error copy (never a raw error_code). */
  error?: string | null;
  helperText?: string;
  required?: boolean;
  /** Trailing element, e.g. a unit suffix ("km", "L") or a reveal toggle. */
  trailing?: React.ReactNode;
  testID?: string;
}

export function Input({
  label,
  error,
  helperText,
  required = false,
  trailing,
  testID,
  ...rest
}: InputProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.error : focused ? colors.primary : colors.outline;

  return (
    <View style={styles.wrapper}>
      <Text variant="label" color={colors.onSurface} style={styles.label}>
        {label}
        {required ? " *" : ""}
      </Text>
      <View style={[styles.field, { borderBottomColor: borderColor, borderBottomWidth: focused || error ? 2 : 1 }]}>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          maxFontSizeMultiplier={a11y.maxFontSizeMultiplier}
          placeholderTextColor={colors.outline}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text variant="caption" color={colors.error} style={styles.helper}>
          {error}
        </Text>
      ) : helperText ? (
        <Text variant="caption" color={colors.onSurfaceVariant} style={styles.helper}>
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  label: { marginBottom: spacing.sm },
  field: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: sizing.inputHeight,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.none,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    ...typography.body,
    fontFamily: "IBMPlexSans-Regular",
    color: colors.onSurface,
    paddingVertical: spacing.sm,
  },
  trailing: { marginLeft: spacing.sm },
  helper: { marginTop: spacing.xs },
});
