import React from "react";
import { TextInput, View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../theme";

/** Labeled text field — Carbon bottom-border style. */
export function AuthField({
  value,
  onChangeText,
  label,
  placeholder,
  secureTextEntry,
  keyboardType,
  testID,
  enabled = true,
}: {
  value: string;
  onChangeText: (t: string) => void;
  label: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: any;
  testID?: string;
  enabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.onSurfaceVariant}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        editable={enabled}
        testID={testID}
        style={[styles.input, { opacity: enabled ? 1 : 0.6 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { color: colors.onSurface, fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceContainer,
    borderBottomWidth: 1,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: colors.outlineVariant,
    borderRadius: 0,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    height: 40,
  },
});
