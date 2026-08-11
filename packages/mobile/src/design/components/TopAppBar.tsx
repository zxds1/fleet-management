// packages/mobile/src/design/components/TopAppBar.tsx
//
// Carbon top app bar (spec `header`): h-12/56px, surface bg, bottom border, title left, leading
// (menu) + trailing (action) icon buttons. Used by every screen once mounted in the routers.

import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { colors, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";

export interface TopAppBarAction {
  icon: IconName;
  onPress: () => void;
  /** Accessible label (required — icons are not text). */
  label: string;
  /** Render a small unread/alert dot on the trailing action. */
  badge?: boolean;
}

export interface TopAppBarProps {
  title: string;
  /** Leading icon button (typically `menu` to open the drawer / go back). */
  leading?: TopAppBarAction;
  /** Trailing actions (e.g. notifications, settings). */
  trailing?: TopAppBarAction[];
  /** Right-aligned title wordmark (brand) instead of left-aligned. */
  centered?: boolean;
  testID?: string;
}

export function TopAppBar({ title, leading, trailing = [], centered, testID }: TopAppBarProps): React.ReactElement {
  return (
    <View
      testID={testID}
      style={{
        height: sizing.topBarHeight,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.outlineVariant,
      } as ViewStyle}
    >
      {leading ? <IconButton action={leading} /> : <View style={{ width: spacing.md }} />}
      <View style={{ flex: 1, alignItems: centered ? "center" : "flex-start", paddingHorizontal: spacing.sm }}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {trailing.map((a, i) => (
          <IconButton key={i} action={a} />
        ))}
      </View>
    </View>
  );
}

function IconButton({ action }: { action: TopAppBarAction }): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      hitSlop={spacing.sm}
      style={({ pressed }) => ({
        width: sizing.topBarHeight,
        height: sizing.topBarHeight,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.none,
        backgroundColor: pressed ? colors.surfaceContainer : "transparent",
      })}
    >
      <Icon name={action.icon} size={24} color={colors.primary} />
      {action.badge ? (
        <View
          style={{
            position: "absolute",
            top: spacing.md - 2,
            right: spacing.md - 2,
            width: 8,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor: colors.error,
          }}
        />
      ) : null}
    </Pressable>
  );
}
