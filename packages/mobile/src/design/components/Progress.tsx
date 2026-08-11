// packages/mobile/src/design/components/Progress.tsx
//
// Carbon linear progress (spec `admin_maintenance_management`, training completion bars). Squared,
// track in `surface-container-high`, fill tinted by tone. Value is a 0..1 fraction.

import React from "react"
import { View } from "react-native"
import { colors, radius, spacing } from "../tokens"
import type { BadgeTone } from "./StatusBadge"

export interface ProgressProps {
  /** Fraction complete, 0..1. */
  value: number
  tone?: BadgeTone
  testID?: string
}

const fill: Record<BadgeTone, string> = {
  neutral: colors.outline,
  info: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.error,
}

export function Progress({ value, tone = "info", testID }: ProgressProps): React.ReactElement {
  const pct = Math.max(0, Math.min(1, value))
  return (
    <View
      testID={testID}
      style={{
        height: 8,
        backgroundColor: colors.surfaceContainerHigh,
        borderRadius: radius.none,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: fill[tone] }} />
    </View>
  )
}
