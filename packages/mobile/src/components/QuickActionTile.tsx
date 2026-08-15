import React from "react";
import { TouchableOpacity, Text, View, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../theme";
import { Icon } from "./Icon";
import { MaterialIcons } from "@expo/vector-icons";

/** 2-up quick action tile — Carbon squared, surfaceContainer bg, IBM Blue accent. */
export function QuickActionTile({
  label,
  onPress,
  danger = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        tileStyles.tile,
        {
          backgroundColor: colors.surfaceContainer,
          borderColor: colors.outlineVariant,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={24} color={danger ? colors.error : colors.primary} /> : null}
      <Text style={[tileStyles.label, { color: danger ? colors.error : colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    height: 96,
    borderRadius: 0,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  label: { fontSize: 14, fontWeight: "600", textAlign: "center" },
});

/** App header (FP monogram + title/subtitle) matching TopBarHeader (DriverApp). */
export function TopBarHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={headerStyles.header}>
      <View style={headerStyles.logo}>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>FP</Text>
      </View>
      <View>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: 12, gap: 12 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 0,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
