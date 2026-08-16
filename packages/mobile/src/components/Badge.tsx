import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Icon } from "./Icon";
import { commandColors } from "../theme/commandColors";

export function AssetBadge({ text }: { text: string }) {
  return (
    <View style={styles.assetBadge}>
      <Text style={styles.assetBadgeText}>{text}</Text>
    </View>
  );
}

export function DelayBadge({ count, onPress }: { count: number; onPress?: () => void }) {
  const content = (
    <View style={styles.delayBadge}>
      <Icon name="cloud-off" size={13} color={commandColors.warning} />
      <Text style={styles.delayText}>{count} delayed</Text>
    </View>
  );
  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>;
  }
  return content;
}

const styles = StyleSheet.create({
  assetBadge: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 9,
    backgroundColor: "rgba(10,10,12,0.88)",
    borderWidth: 1,
    borderColor: commandColors.border,
  },
  assetBadgeText: {
    color: "#BFC0C7",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.7,
  },
  delayBadge: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    backgroundColor: "rgba(251,191,36,0.08)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.32)",
  },
  delayText: {
    color: commandColors.warning,
    fontSize: 9,
    fontWeight: "600",
  },
});
