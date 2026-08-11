// packages/mobile/src/design/components/DataTable.tsx
//
// Carbon data table for the data-dense admin screens (Drivers, Expiring Documents, Anomaly Detail
// sensor timeline). Spec uses a `surface-container-low` header, hairline row dividers, and optional
// row actions. Rendered as a scrollable, column-flexible list (RN has no native <table>).

import React from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../tokens";
import { Text } from "./Text";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  /** Render the cell for a row. */
  render: (row: T) => React.ReactNode;
  /** Flex weight (default 1). */
  flex?: number;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Optional per-row action renderer (e.g. Edit/Notify buttons). */
  rowActions?: (row: T) => React.ReactNode;
  onRowPress?: (row: T) => void;
  testID?: string;
}

export function DataTable<T>({ columns, rows, rowActions, onRowPress, testID }: DataTableProps<T>): React.ReactElement {
  return (
    <ScrollView testID={testID} horizontal style={{ flex: 1 }}>
      <View style={{ minWidth: "100%" }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.surfaceContainer,
            borderBottomWidth: 1,
            borderBottomColor: colors.outlineVariant,
          } as ViewStyle}
        >
          {columns.map((c) => (
            <View key={c.key} style={{ flex: c.flex ?? 1, padding: spacing.md }}>
              <Text variant="label" color={colors.onSurfaceVariant} style={{ textTransform: "uppercase" as const, letterSpacing: 0.5 }}>
                {c.header}
              </Text>
            </View>
          ))}
          {rowActions ? <View style={{ width: 120, padding: spacing.md }} /> : null}
        </View>
        {rows.map((row, i) => (
          <Pressable
            key={i}
            disabled={!onRowPress}
            onPress={onRowPress ? () => onRowPress(row) : undefined}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: pressed && onRowPress ? colors.surfaceContainer : i % 2 === 1 ? colors.surface : colors.surfaceContainerLowest,
              borderBottomWidth: 1,
              borderBottomColor: colors.outlineVariant,
            })}
          >
            {columns.map((c) => (
              <View
                key={c.key}
                style={{
                  flex: c.flex ?? 1,
                  padding: spacing.md,
                  alignItems: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start",
                }}
              >
                {c.render(row)}
              </View>
            ))}
            {rowActions ? <View style={{ width: 120, padding: spacing.md, flexDirection: "row", gap: spacing.sm }}>{rowActions(row)}</View> : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
