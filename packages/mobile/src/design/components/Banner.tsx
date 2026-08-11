// packages/mobile/src/design/components/Banner.tsx
import React from "react";
import { View, TouchableOpacity } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";

export interface BannerProps {
  tone: "info" | "warning" | "danger" | "success";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

const TONE_BG: Record<BannerProps["tone"], string> = {
  info: theme.colors.infoContainer,
  warning: theme.colors.warningContainer,
  danger: theme.colors.errorContainer,
  success: theme.colors.successContainer,
};

const TONE_FG: Record<BannerProps["tone"], string> = {
  info: theme.colors.onPrimaryContainer,
  warning: theme.colors.onSurface,
  danger: theme.colors.onErrorContainer,
  success: theme.colors.onSuccessContainer,
};

export function Banner({ tone, message, actionLabel, onAction, testID }: BannerProps) {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: TONE_BG[tone],
        paddingHorizontal: theme.spacing[5],
        paddingVertical: theme.spacing[3],
        minHeight: theme.sizing.minTouchTarget,
      }}
    >
      <Text preset="label01" color={TONE_FG[tone]} style={{ flex: 1 }}>
        {message}
      </Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={8}
          style={{ minHeight: theme.sizing.minTouchTarget, justifyContent: "center", marginLeft: theme.spacing[4] }}
        >
          <Text preset="label02" color={theme.colors.primary}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
