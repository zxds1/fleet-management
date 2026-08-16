import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { commandColors } from "../theme/commandColors";
import { mono } from "../theme/commandColors";

export function TelemetryCard({
  children,
  metrics,
  style,
}: {
  children?: React.ReactNode;
  metrics?: Array<{ label: string; value: string; unit?: string; fuelPct?: number }>;
  style?: any;
}) {
  return (
    <View style={[styles.card, style]}>
      {children}
      {metrics && metrics.length > 0 ? (
        <View style={styles.metricsRow}>
          {metrics.map((m, i) => (
            <View key={i} style={[styles.metric, i < metrics.length - 1 && styles.metricBorder]}>
              <Text style={styles.metricLabel}>{m.label}</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.metricValue, mono]} numberOfLines={1}>
                  {m.value}
                </Text>
                {m.unit ? <Text style={styles.metricUnit}>{m.unit}</Text> : null}
              </View>
              {m.fuelPct != null ? (
                <View style={styles.fuelTrack}>
                  <View
                    style={[
                      styles.fuelFill,
                      { width: `${Math.max(0, Math.min(100, m.fuelPct))}%` },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: commandColors.borderStrong,
  },
  metricsRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: commandColors.border,
    flexDirection: "row",
  },
  metric: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 7,
  },
  metricBorder: {
    borderRightWidth: 1,
    borderRightColor: commandColors.border,
  },
  metricLabel: {
    color: commandColors.textDim,
    fontSize: 8,
    letterSpacing: 0.7,
  },
  metricValueRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  metricValue: {
    color: commandColors.white,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  metricUnit: {
    color: commandColors.textDim,
    fontSize: 7,
  },
  fuelTrack: {
    height: 2,
    marginHorizontal: 7,
    marginTop: 5,
    backgroundColor: commandColors.border,
  },
  fuelFill: {
    height: 2,
    backgroundColor: commandColors.info,
  },
});
