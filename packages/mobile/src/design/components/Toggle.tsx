// packages/mobile/src/design/components/Toggle.tsx
//
// Carbon toggle (spec `.carbon-toggle`): 48×24 track, #8d8d8d off, success (green60) on, 20px white
// knob. Used in Profile/Settings, consent, DVIR items, anomaly resolution.

import React from "react";
import { Pressable, Animated, View, type ViewStyle } from "react-native";
import { colors, radius, sizing, spacing } from "../tokens";

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  testID?: string;
}

export function Toggle({ value, onValueChange, label, disabled = false, testID }: ToggleProps): React.ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => ({
        width: 48,
        height: 24,
        borderRadius: radius.pill,
        backgroundColor: disabled ? colors.surfaceContainerHigh : value ? colors.success : colors.outline,
        opacity: pressed && !disabled ? 0.85 : 1,
        alignItems: value ? "flex-end" : "flex-start",
        justifyContent: "center",
        paddingHorizontal: 2,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
        }}
      />
    </Pressable>
  );
}
