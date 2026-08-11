// packages/mobile/src/design/components/ListRow.tsx
import React from "react";
import { View, TouchableOpacity, ViewStyle } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

/** Carbon list row: 48px+ height, square corners, hairline divider, full-width tap target. */
export function ListRow({ title, subtitle, trailing, onPress, disabled, testID }: ListRowProps) {
  const Container: React.ElementType = onPress ? TouchableOpacity : View;
  return (
    <Container
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      disabled={disabled}
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing[3],
        paddingHorizontal: theme.spacing[5],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.ui03,
        opacity: disabled ? 0.5 : 1,
      } as ViewStyle}
    >
      <View style={{ flex: 1 }}>
        <Text style={theme.textStyle.body02}>{title}</Text>
        {subtitle && (
          <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Container>
  );
}
