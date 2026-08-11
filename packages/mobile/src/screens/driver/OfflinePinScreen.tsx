// packages/mobile/src/screens/driver/OfflinePinScreen.tsx
//
// B.3 Offline PIN (field re-auth). A 4-digit local PIN unlocks the secure store with no network.
// 5 failures → 15 min local lock (`OFFLINE_PIN_LOCKED`), 10 → PIN wiped + forced online login; the
// caller owns that policy and simply passes `attemptsRemaining` / `locked` down here.

import React, { useState } from "react"
import { View, ScrollView, Pressable } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"

export interface OfflinePinScreenProps {
  attemptsRemaining: number
  locked: boolean
  onUnlock: (pin: string) => void
  onGoOnline: () => void
  /** Optional inline message (e.g. wrong PIN), already localized by the caller. */
  error?: string | null
  submitting?: boolean
}

const PIN_LENGTH = 4
const KEYS: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"]

export function OfflinePinScreen({
  attemptsRemaining,
  locked,
  onUnlock,
  onGoOnline,
  error,
  submitting = false,
}: OfflinePinScreenProps) {
  const [pin, setPin] = useState("")

  const press = (key: string) => {
    if (locked) return
    if (key === "del") {
      setPin((p) => p.slice(0, -1))
      return
    }
    if (!key) return
    setPin((p) => (p.length >= PIN_LENGTH ? p : p + key))
  }

  const complete = pin.length === PIN_LENGTH

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing[5] }} testID="offline-pin-screen">
      <View style={{ alignItems: "center", marginTop: theme.spacing[5] }}>
        <Icon name="lock" size={40} color={theme.colors.primary} />
        <Text preset="heading03" align="center" style={{ marginTop: theme.spacing[4] }}>
          {t("auth.pinTitle")}
        </Text>
        <Text
          preset="body02"
          color={theme.colors.onSurfaceVariant}
          align="center"
          style={{ marginTop: theme.spacing[3] }}
        >
          {t("auth.pinSubtitle")}
        </Text>
      </View>

      {/* PIN indicator: four squared cells (Carbon squared corners). */}
      <View
        style={{ flexDirection: "row", justifyContent: "center", gap: theme.spacing[4], marginTop: theme.spacing[5] }}
        accessibilityLabel={t("auth.pinEnterFour")}
        testID="offline-pin-dots"
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={{
              width: 20,
              height: 20,
              backgroundColor: i < pin.length ? theme.colors.primary : theme.colors.ui03,
              borderWidth: 1,
              borderColor: i < pin.length ? theme.colors.primary : theme.colors.outlineVariant,
            }}
          />
        ))}
      </View>

      <View style={{ alignItems: "center", marginTop: theme.spacing[4] }}>
        {locked ? (
          <Text preset="bodyStrong" color={theme.colors.error} align="center">
            {t("errors.OFFLINE_PIN_LOCKED")}
          </Text>
        ) : (
          <Text preset="caption" color={theme.colors.onSurfaceVariant} align="center">
            {t("auth.pinAttemptsRemaining", { count: attemptsRemaining })}
          </Text>
        )}
        {error ? (
          <Text preset="caption" color={theme.colors.error} align="center" style={{ marginTop: theme.spacing[2] }}>
            {error}
          </Text>
        ) : null}
      </View>

      {/* Keypad — every key is a 48px+ touch target on the 8px grid. */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: theme.spacing[5],
        }}
      >
        {KEYS.map((key, index) => {
          if (!key) return <View key={`spacer-${index}`} style={{ width: "33.33%", height: 64 }} />
          return (
            <Pressable
              key={key}
              testID={`pin-key-${key}`}
              accessibilityRole="button"
              accessibilityLabel={key === "del" ? t("auth.pinDelete") : key}
              disabled={locked}
              onPress={() => press(key)}
              style={({ pressed }) => ({
                width: "33.33%",
                height: 64,
                minHeight: theme.sizing.minTouchTarget,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? theme.colors.ui03 : theme.colors.ui02,
                borderWidth: 1,
                borderColor: theme.colors.outlineVariant,
                opacity: locked ? 0.5 : 1,
              })}
            >
              {key === "del" ? (
                <Icon name="close" size={theme.sizing.iconLg} color={theme.colors.onSurfaceVariant} />
              ) : (
                <Text preset="title">{key}</Text>
              )}
            </Pressable>
          )
        })}
      </View>

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button
          onPress={() => onUnlock(pin)}
          disabled={!complete || locked}
          loading={submitting}
          icon={<Icon name="lock" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
          label={t("auth.unlock")}
          testID="offline-pin-unlock"
        />
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="ghost" onPress={onGoOnline} label={t("auth.cantUnlock")} testID="offline-pin-go-online" />
        </View>
      </View>
    </ScrollView>
  )
}
