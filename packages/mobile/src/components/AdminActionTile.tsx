import React from "react";
import { TouchableOpacity, Text, View } from "react-native";
import { colors, typography } from "../theme";
import { Icon } from "./Icon";
import { MaterialIcons } from "@expo/vector-icons";

/** Square action tile with icon + label, used in admin dashboard and settings. */
export function AdminActionTile({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: "46%",
        minHeight: 64,
        borderRadius: 0,
        borderWidth: 1,
        borderColor: colors.outlineVariant,
        backgroundColor: colors.surfaceContainer,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: 8,
      }}
    >
      <Icon name={icon} size={24} color={colors.primary} />
      <Text style={[typography.bodySmall, { color: colors.onSurface, textAlign: "center" }]}>{label}</Text>
    </TouchableOpacity>
  );
}
