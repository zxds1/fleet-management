import React from "react";
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, typography } from "../theme";

/** Standard scrollable screen surface with a white canvas. */
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: any;
}) {
  if (scroll) {
    return (
      <SafeAreaView style={[styles.safe, style]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[styles.safe, style]}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

/** Header with optional back button, used by admin/driver stack screens. */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: (() => void) | null;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.headerBar}>
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={{ marginRight: spacing.sm }}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[typography.titleMedium, { color: colors.onSurface }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.outlineVariant,
  },
});
