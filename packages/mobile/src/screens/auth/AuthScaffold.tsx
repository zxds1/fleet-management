import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { TopBarHeader } from "../../components/QuickActionTile";

/** Shared auth screen scaffold (mirrors AuthScaffold in Kotlin). */
export function AuthScaffold({
  title,
  subtitle,
  children,
  testID,
}: {
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={scaffoldStyles.safe}>
      <View style={scaffoldStyles.content}>
        <TopBarHeader title="FleetPulse" subtitle={subtitle ?? ""} />
        <Text style={[typography.titleLarge, { color: colors.onSurface }]}>{title}</Text>
        <View style={{ gap: spacing.md }}>{children}</View>
      </View>
    </View>
  );
}

const scaffoldStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
});

/** Two-option segmented toggle (driver = phone / admin = email). */
export function AuthSegmentedToggle({
  options,
  selectedIndex,
  onSelect,
  enabled = true,
}: {
  options: string[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  enabled?: boolean;
}) {
  return (
    <View style={toggleStyles.toggle}>
      {options.map((opt, i) => (
        <AuthToggleButton
          key={opt}
          label={opt}
          active={i === selectedIndex}
          onPress={() => enabled && onSelect(i)}
        />
      ))}
    </View>
  );
}

function AuthToggleButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={[
        toggleStyles.toggleBtn,
        {
          backgroundColor: active ? colors.primary : colors.surfaceContainer,
          color: active ? colors.onSurface : colors.onSurfaceVariant,
        },
      ]}
    >
      {label}
    </Text>
  );
}

const toggleStyles = StyleSheet.create({
  toggle: { flexDirection: "row", backgroundColor: colors.surfaceContainer, borderRadius: 0, padding: 4, gap: 4, borderWidth: 1, borderColor: colors.outlineVariant },
  toggleBtn: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 10,
     borderRadius: 0,
    fontWeight: "600",
    fontSize: 14,
    overflow: "hidden",
  },
});

