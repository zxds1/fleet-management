// packages/mobile/src/design/components/Card.tsx
// Carbon card: white surface, squared, separated by a bottom border rather than a shadow
// (DESIGN.md "Gray background shifts preferred over shadows").

import React from "react";
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../tokens";
import { Text } from "./Text";

export interface CardProps {
  title?: string;
  subtitle?: string;
  /** Rendered top-right — typically a `StatusBadge`. */
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  /** Surface tint: `surface` (white) or `container` (gray10, the spec's card default). */
  variant?: "surface" | "container";
  /** Severity accent drawn as a 4px left border (spec `border-l-4`). */
  accent?: string;
}

export function Card({
  title,
  subtitle,
  trailing,
  children,
  onPress,
  style,
  testID,
  accessibilityLabel,
  variant = "container",
  accent,
}: CardProps): React.ReactElement {
  const body = (
    <>
      {title || trailing ? (
        <View style={styles.header}>
          <View style={styles.headerText}>
            {title ? <Text variant="subtitle">{title}</Text> : null}
            {subtitle ? (
              <Text variant="caption" color={colors.secondary} style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {trailing ? <View>{trailing}</View> : null}
        </View>
      ) : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        onPress={onPress}
        style={({ pressed }) => [styles.card, { backgroundColor: variant === "surface" ? colors.surface : colors.surfaceContainer, borderLeftColor: accent ?? "transparent", borderLeftWidth: accent ? 4 : 0 }, pressed && styles.pressed, style]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: variant === "surface" ? colors.surface : colors.surfaceContainer, borderLeftColor: accent ?? "transparent", borderLeftWidth: accent ? 4 : 0 }, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.none,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.9 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.sm },
  headerText: { flex: 1, paddingRight: spacing.sm },
  subtitle: { marginTop: spacing.xxs },
});
