import React from "react";
import { View, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { MaterialIcons } from "@expo/vector-icons";

export function MapMarker({ color, selected = false, children, style }: { color: string; selected?: boolean; children?: React.ReactNode; style?: any }) {
  return (
    <View style={[styles.marker, selected && { borderColor: color, backgroundColor: `${color}24` }, style]}>
      {children ?? <Icon name="navigation" size={selected ? 21 : 18} color={color} />}
    </View>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
});
