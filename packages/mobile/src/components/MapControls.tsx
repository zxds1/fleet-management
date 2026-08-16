import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { MaterialIcons } from "@expo/vector-icons";
import { commandColors } from "../theme/commandColors";

export function MapControls({ children, style, gap = 6 }: { children: React.ReactNode; style?: any; gap?: number }) {
  return <View style={[styles.container, { gap }, style]}>{children}</View>;
}

export function MapControlButton({ icon, onPress, accessibilityLabel, testID }: { icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void; accessibilityLabel: string; testID?: string }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID}>
      <Icon name={icon} size={17} color={commandColors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 12,
    top: 12,
  },
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,12,0.88)",
    borderWidth: 1,
    borderColor: commandColors.border,
  },
});
