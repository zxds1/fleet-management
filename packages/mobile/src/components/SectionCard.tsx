import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

/** Surface card matching SectionCard base in the Kotlin app. */
export function SectionCard({ children, title, style }: { children: React.ReactNode; title?: string; style?: any }) {
  return (
    <View style={[styles.card, style]}>
      <View style={{ padding: spacing.lg }}>
        {title ? <Text style={[typography.titleMedium, { color: colors.onSurface, marginBottom: 8 }]}>{title}</Text> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    width: "100%",
  },
});
