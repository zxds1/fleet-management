// packages/mobile/src/design/components/BottomNav.tsx
//
// Driver bottom navigation (flows.md A.5): Home / Refuel / Inspect / Accidents / More.
// 56px (sizing.bottomNavHeight), surface bg, top border; active tab gets a 2px primary top border
// + primary coloured icon/label (spec `driver_home_1` BottomNavBar).

import React from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { colors, radius, sizing, spacing } from "../tokens";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";

export interface BottomNavItem {
  key: string;
  label: string;
  icon: IconName;
  filledIcon?: IconName;
  active: boolean;
  onPress: () => void;
  badge?: number;
}

export interface BottomNavProps {
  items: BottomNavItem[];
  testID?: string;
}

export function BottomNav({ items, testID }: BottomNavProps): React.ReactElement {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        height: sizing.bottomNavHeight,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.outlineVariant,
      } as ViewStyle}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: item.active }}
          onPress={item.onPress}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderTopWidth: 2,
            borderTopColor: item.active ? colors.primary : "transparent",
            backgroundColor: pressed ? colors.surfaceContainer : "transparent",
          })}
        >
          <View>
            <Icon name={item.active ? (item.filledIcon ?? item.icon) : item.icon} size={24} color={item.active ? colors.primary : colors.secondary} />
            {item.badge ? (
              <View
                style={{
                  position: "absolute",
                  top: -2,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  borderRadius: radius.pill,
                  backgroundColor: colors.error,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 4,
                }}
              >
                <Text variant="label" color={colors.onError} style={{ fontSize: 10 }}>
                  {item.badge > 9 ? "9+" : String(item.badge)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            variant="label"
            color={item.active ? colors.primary : colors.secondary}
            style={{ fontSize: 10, marginTop: 2 }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
