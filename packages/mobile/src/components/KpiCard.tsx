import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

/** KPI tile matching KpiCard (AdminHelpers.kt). */
export function KpiCard({
  label,
  value,
  color,
  icon,
  onPress,
  style,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: string;
  onPress?: (() => void) | null;
  style?: any;
}) {
  const card = (
    <View style={[kpiStyles.card, style]}>
      <View style={kpiStyles.head}>
        {icon ? <Text style={[kpiStyles.icon, { color: color ?? colors.primary }]}>{icon}</Text> : null}
        <Text style={kpiStyles.label}>{label}</Text>
      </View>
      <Text style={[kpiStyles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ flex: 1 }}>
        {card}
      </TouchableOpacity>
    );
  }
  return <View style={{ flex: 1 }}>{card}</View>;
}

const kpiStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.lg,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { fontSize: 18 },
  label: { color: colors.onSurfaceVariant, fontSize: 12, fontWeight: "600" },
  value: { color: colors.onSurface, fontSize: 22, fontWeight: "600", marginTop: 8 },
});

/** Row card matching AdminRowCard (AdminHelpers.kt). */
export function AdminRowCard({
  title,
  subtitle,
  trailing,
  onPress,
  style,
}: {
  title: string;
  subtitle?: string | null;
  trailing?: string | null;
  onPress?: (() => void) | null;
  style?: any;
}) {
  const content = (
    <View style={[rowStyles.row, style]}>
      <View style={{ flex: 1 }}>
        <Text style={rowStyles.title}>{title}</Text>
        {subtitle ? <Text style={rowStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={rowStyles.trailing}>{trailing}</Text> : null}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={rowStyles.rowWrap}>
        {content}
      </TouchableOpacity>
    );
  }
  return <View style={rowStyles.rowWrap}>{content}</View>;
}

const rowStyles = StyleSheet.create({
  rowWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.lg },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  subtitle: { color: colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  trailing: { color: colors.primary, fontSize: 12, marginLeft: 8 },
});
