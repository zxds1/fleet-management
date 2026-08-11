// packages/mobile/src/design/components/SideNav.tsx
//
// Admin side navigation (flows.md A.6, tablet): 10-item drawer with active incident counters as
// badges and a 4px primary left accent on the active item (spec `admin_*` Navigation Drawer).

import React from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { colors, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";

export interface SideNavItem {
  key: string;
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
  /** Incident counter badge (e.g. open accidents). */
  badge?: number;
}

export interface SideNavProps {
  title: string;
  subtitle?: string;
  items: SideNavItem[];
  testID?: string;
}

export function SideNav({ title, subtitle, items, testID }: SideNavProps): React.ReactElement {
  return (
    <View
      testID={testID}
      style={{
        width: 256,
        backgroundColor: colors.surfaceContainer,
        borderRightWidth: 1,
        borderRightColor: colors.outlineVariant,
      } as ViewStyle}
    >
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.onSurfaceVariant} style={{ marginTop: spacing.xxs }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <ScrollView style={{ flex: 1 }}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: item.active }}
            onPress={item.onPress}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              borderLeftWidth: 4,
              borderLeftColor: item.active ? colors.primary : "transparent",
              backgroundColor: item.active ? colors.secondaryContainer : pressed ? colors.surfaceContainerHigh : "transparent",
            })}
          >
            <Icon name={item.icon} size={24} color={item.active ? colors.onPrimaryContainer : colors.onSurfaceVariant} />
            <Text
              variant="bodyStrong"
              color={item.active ? colors.onPrimaryContainer : colors.onSurfaceVariant}
              style={{ flex: 1 }}
            >
              {item.label}
            </Text>
            {item.badge ? (
              <View
                style={{
                  minWidth: 20,
                  height: 20,
                  borderRadius: radius.pill,
                  backgroundColor: colors.error,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 6,
                }}
              >
                <Text variant="label" color={colors.onError} style={{ fontSize: 11 }}>
                  {item.badge > 99 ? "99+" : String(item.badge)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
