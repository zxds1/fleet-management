// packages/mobile/src/screens/driver/OnboardingProgress.tsx
//
// The "Step N of 4" header shared by all four onboarding specs: a squared 4px track filled to the
// current step, the step counter, and the step labels. Deliberately a local screen helper rather
// than a design-system component — it is specific to this one flow and composes only `Text` and
// theme tokens (no new primitives).

import React from "react"
import { View } from "react-native"
import { Text } from "@/design/components/Text"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"

/** Step labels in flow order; the index is the 1-based step number. */
const STEP_LABEL_KEYS = [
  "driver.onboarding.steps.profile",
  "driver.onboarding.steps.background",
  "driver.onboarding.steps.vehicle",
  "driver.onboarding.steps.ready",
] as const

export const ONBOARDING_STEP_COUNT = STEP_LABEL_KEYS.length

export interface OnboardingProgressProps {
  /** 1-based current step (1…4). */
  step: number
  testID?: string
}

export function OnboardingProgress({ step, testID }: OnboardingProgressProps) {
  const clamped = Math.min(Math.max(step, 1), ONBOARDING_STEP_COUNT)
  const percent = `${(clamped / ONBOARDING_STEP_COUNT) * 100}%` as const

  return (
    <View testID={testID ?? "onboarding-progress"}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Text variant="label" color={theme.colors.onSurfaceVariant} style={{ textTransform: "uppercase" }}>
          {t("driver.onboarding.title")}
        </Text>
        <Text variant="label" color={theme.colors.onSurfaceVariant}>
          {t("driver.onboarding.step", { current: clamped, total: ONBOARDING_STEP_COUNT })}
        </Text>
      </View>

      <View
        style={{
          height: 4,
          backgroundColor: theme.colors.surfaceContainerHigh,
          marginTop: theme.spacing[3],
          borderRadius: theme.radius.none,
        }}
      >
        <View style={{ width: percent, height: "100%", backgroundColor: theme.colors.primary }} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing[2] }}>
        {STEP_LABEL_KEYS.map((key, index) => {
          const isCurrent = index + 1 === clamped
          return (
            <Text
              key={key}
              variant="caption"
              color={isCurrent ? theme.colors.primary : theme.colors.secondary}
              style={isCurrent ? { fontWeight: "600" } : undefined}
            >
              {t(key)}
            </Text>
          )
        })}
      </View>
    </View>
  )
}
