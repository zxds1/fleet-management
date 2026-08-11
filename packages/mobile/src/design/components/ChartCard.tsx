// packages/mobile/src/design/components/ChartCard.tsx
//
// Carbon chart card for the analytics/reports screens. Supports two compact visualisations that
// need no native charting dependency: a utilisation heatmap (day × hour cells) and a simple bar
// chart (labeled values). Both use the design tokens so they stay on-palette. Purely illustrative
// until `/reports` payloads carry real series; the component only renders the data it is given.

import React from "react"
import { View } from "react-native"
import { colors, radius, spacing } from "../tokens"
import { Text } from "./Text"

export interface ChartHeatmap {
  days: string[]
  hours: string[]
  values: number[][] // [hourIndex][dayIndex]
}

export interface ChartBar {
  labels: string[]
  values: number[]
}

export interface ChartCardProps {
  title: string
  type: "heatmap" | "bar"
  heatmap?: ChartHeatmap
  bar?: ChartBar
  testID?: string
}

function heatColor(v: number): string {
  // v expected roughly in [-10, 100]; clamp and map to container→primary fill.
  const clamped = Math.max(0, Math.min(100, v))
  const alpha = 0.12 + (clamped / 100) * 0.7
  return colors.primary + Math.round(alpha * 255).toString(16).padStart(2, "0")
}

export function ChartCard({ title, type, heatmap, bar, testID }: ChartCardProps): React.ReactElement {
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.surfaceContainer,
        borderRadius: radius.none,
        borderBottomWidth: 1,
        borderBottomColor: colors.outlineVariant,
        padding: spacing.md,
      }}
    >
      <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>
        {title}
      </Text>
      {type === "heatmap" && heatmap ? (
        <View>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 36 }} />
            {heatmap.days.map((d) => (
              <View key={d} style={{ flex: 1, alignItems: "center" }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {d}
                </Text>
              </View>
            ))}
          </View>
          {heatmap.hours.map((h, hi) => (
            <View key={h} style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.xs }}>
              <Text variant="caption" color={colors.onSurfaceVariant} style={{ width: 36 }}>
                {h}
              </Text>
              {heatmap.days.map((d, di) => (
                <View
                  key={d}
                  style={{
                    flex: 1,
                    height: 18,
                    margin: 1,
                    backgroundColor: heatColor(heatmap.values[hi]?.[di] ?? 0),
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {type === "bar" && bar ? (
        <View>
          {bar.values.map((v, i) => {
            const max = Math.max(1, ...bar.values)
            return (
              <View key={i} style={{ marginBottom: spacing.sm }}>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  {bar.labels[i] ?? ""}
                </Text>
                <View style={{ height: 10, backgroundColor: colors.surfaceContainerHigh, marginTop: 2 }}>
                  <View style={{ width: `${(v / max) * 100}%`, height: 10, backgroundColor: colors.primary }} />
                </View>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}
