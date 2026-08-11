// packages/mobile/src/design/components/MultiSelectSheet.tsx
//
// Token-driven multi-select picker used by the admin assignment screens: pick vehicles / drivers to
// assign to an admin, or drivers / cars to assign to a vehicle. Built on `BottomSheet` so phone gets
// a bottom sheet and tablet gets a centered dialog. Searchable; checkmarks track selection; a footer
// "Done" commits. Reused verbatim — callers supply the option list + selected set.

import React, { useMemo, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "../theme"
import { Text } from "./Text"
import { Button } from "./Button"
import { Input } from "./Input"
import { Icon } from "./Icon"
import { BottomSheet } from "./BottomSheet"

export interface MultiSelectOption {
  value: string
  label: string
  /** Optional secondary line (e.g. plate under a driver name). */
  hint?: string
}

export interface MultiSelectSheetProps {
  open: boolean
  onClose: () => void
  title: string
  options: MultiSelectOption[]
  selected: string[]
  onToggle: (value: string) => void
  /** Centered dialog on tablet. */
  centered?: boolean
  searchable?: boolean
  /** Presentational copy (localized by the caller). */
  searchPlaceholder?: string
  emptyText?: string
  doneLabel?: string
  testID?: string
}

export function MultiSelectSheet({
  open,
  onClose,
  title,
  options,
  selected,
  onToggle,
  centered,
  searchable = true,
  searchPlaceholder = "",
  emptyText = "",
  doneLabel = "",
  testID,
}: MultiSelectSheetProps) {
  const [query, setQuery] = useState("")
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => [o.label, o.hint ?? ""].some((v) => v.toLowerCase().includes(q)))
  }, [options, query])

  return (
    <BottomSheet open={open} onClose={onClose} title={title} centered={centered}>
      <View testID={testID}>
        {searchable ? (
          <Input
            label={""}
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            testID="multiselect-search"
            trailing={<Icon name="search" size={theme.sizing.iconMd} color={theme.colors.textSecondary} />}
          />
        ) : null}

        <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: theme.spacing[2] }}>
          {filtered.length === 0 ? (
            <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ paddingVertical: theme.spacing[3] }}>
              {emptyText}
            </Text>
          ) : (
            filtered.map((o) => {
              const isOn = selectedSet.has(o.value)
              return (
                <View
                  key={o.value}
                  testID={`multiselect-row-${o.value}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 48,
                    paddingVertical: theme.spacing[2],
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.ui03,
                  }}
                >
                  <View style={{ marginRight: theme.spacing[3] }}>
                    <Icon
                      name={isOn ? "check_circle" : "radio_button_unchecked"}
                      size={theme.sizing.iconMd}
                      color={isOn ? theme.colors.primary : theme.colors.onSurfaceVariant}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text preset="body02">{o.label}</Text>
                    {o.hint ? (
                      <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                        {o.hint}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    onStartShouldSetResponder={() => {
                      onToggle(o.value)
                      return true
                    }}
                    style={{ padding: theme.spacing[2] }}
                  >
                    <Text preset="label" color={theme.colors.primary}>
                      {isOn ? "✓" : "+"}
                    </Text>
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>

        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.spacing[3] }}
        >
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {selected.length}
          </Text>
          <Button variant="primary" fullWidth={false} onPress={onClose} testID="multiselect-done">
            {doneLabel}
          </Button>
        </View>
      </View>
    </BottomSheet>
  )
}
