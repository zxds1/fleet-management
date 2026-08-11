// packages/mobile/src/design/components/Skeleton.tsx
import React from "react";
import { View, type DimensionValue } from "react-native";
import { theme } from "../theme";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  testID?: string;
}

/** Carbon-style shimmer placeholder. Animated shimmer is overkill for a skeleton; static grey is fine. */
export function Skeleton({ width = "100%", height = 16, radius, testID }: SkeletonProps) {
  return (
    <View
      testID={testID}
      style={{
        width,
        height,
        borderRadius: radius ?? theme.radius.sm,
        backgroundColor: theme.colors.ui03,
      }}
    />
  );
}

export function SkeletonRow() {
  return (
    <View style={{ paddingVertical: theme.spacing[3] ?? 8 }}>
      <Skeleton width="40%" height={12} />
      <View style={{ height: theme.spacing[2] ?? 4 }} />
      <Skeleton width="80%" height={16} />
    </View>
  );
}
