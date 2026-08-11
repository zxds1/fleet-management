// packages/mobile/src/design/components/StatCard.tsx
//
// Dashboard summary card (spec `admin_dashboard` stat cards): surface, squared, accent top-border
// by tone, large metric value + label. Tapping navigates to the relevant screen.

import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { colors, radius, spacing, typography } from "../tokens";
import { Text } from "./Text";
import type { BadgeTone } from "./StatusBadge";

export interface StatCardProps {
  label: string;
  value: string;
  tone?: BadgeTone;
  onPress?: () => void;
  testID?: string;
}

const accent: Record<BadgeTone, string> = {
  neutral: colors.outlineVariant,
  info: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.error,
};

export function StatCard({ label, value, tone = "neutral", onPress, testID }: StatCardProps): React.ReactElement {
  const body = (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.surfaceContainer,
        borderRadius: radius.none,
        borderTopWidth: 2,
        borderTopColor: accent[tone],
        padding: spacing.md,
        minWidth: 140,
        flex: 1,
        margin: spacing.sm / 2,
      } as ViewStyle}
    >
      <Text variant="metric" color={tone === "neutral" ? colors.onSurface : colors.onSurface}>
        {value}
      </Text>
      <Text
        variant="label"
        color={colors.onSurfaceVariant}
        style={{ marginTop: spacing.xs, textTransform: "uppercase" as const, letterSpacing: 0.5 }}
      >
        {label}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
        {body}
      </Pressable>
    );
  }
  return body;
}
