// packages/mobile/src/screens/driver/ReadyToDriveScreen.tsx
//
// Onboarding step 4 (spec `driver_onboarding_ready_to_drive`). Read-only confirmation: it re-reads
// the onboarding record and the vehicle assignment, summarises name / licence / background-check
// status / vehicle, and hands off to the driver home via `onComplete`.

import React, { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { Icon } from "@/design/components/Icon"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { BackgroundCheckStatus, OnboardingState, VehicleAssignment } from "@/core/driver/onboarding"
import { OnboardingProgress } from "./OnboardingProgress"

export interface ReadyToDriveScreenProps {
  services: Services
  onComplete: () => void
}

const STATUS_TONE: Record<BackgroundCheckStatus, BadgeTone> = {
  NOT_STARTED: "neutral",
  SUBMITTED: "info",
  CLEARED: "success",
  FAILED: "danger",
}

export function ReadyToDriveScreen({ services, onComplete }: ReadyToDriveScreenProps) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [assignment, setAssignment] = useState<VehicleAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    // The two reads are independent: a missing assignment must still let the summary render.
    const [onboarding, vehicle] = await Promise.allSettled([
      services.onboarding.getState(),
      services.onboarding.getAssignment(),
    ])
    if (onboarding.status === "fulfilled") {
      setState(onboarding.value)
      setError(undefined)
    } else {
      setError(fromUnknown(onboarding.reason))
    }
    if (vehicle.status === "fulfilled") setAssignment(vehicle.value)
    setLoading(false)
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <View style={{ flex: 1, padding: theme.spacing[5], gap: theme.spacing[4] }} testID="onboarding-ready-loading">
        <Skeleton width="60%" height={28} />
        <Skeleton height={160} />
        <Skeleton height={48} />
      </View>
    )
  }

  const status: BackgroundCheckStatus = state?.background_check_status ?? "NOT_STARTED"
  const licence = state?.licence_number
    ? state.licence_class
      ? `${state.licence_number} · ${state.licence_class}`
      : state.licence_number
    : t("common.notAvailable")

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="onboarding-ready-screen">
      <OnboardingProgress step={4} />

      <View style={{ alignItems: "center", marginTop: theme.spacing[6], marginBottom: theme.spacing[5] }}>
        <Icon name="check_circle" size={48} color={theme.colors.success} filled />
        <Text preset="heading03" align="center" style={{ marginTop: theme.spacing[4] }}>
          {t("driver.onboarding.ready.title")}
        </Text>
        <Text
          preset="body02"
          color={theme.colors.onSurfaceVariant}
          align="center"
          style={{ marginTop: theme.spacing[2] }}
        >
          {t("driver.onboarding.ready.subtitle")}
        </Text>
      </View>

      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="onboarding-ready-error" />
        </View>
      ) : null}

      <Card variant="container" title={t("driver.onboarding.ready.summary")} style={{ padding: 0 }}>
        <ListRow
          title={t("driver.onboarding.ready.driverName")}
          trailing={<Text variant="bodyStrong">{state?.full_name ?? t("common.notAvailable")}</Text>}
          testID="onboarding-ready-name"
        />
        <ListRow
          title={t("driver.onboarding.ready.licence")}
          trailing={<Text variant="bodyStrong">{licence}</Text>}
          testID="onboarding-ready-licence"
        />
        <ListRow
          title={t("driver.onboarding.ready.backgroundCheck")}
          trailing={
            <StatusBadge
              label={t(`driver.onboarding.status.${status}`)}
              tone={STATUS_TONE[status]}
              testID="onboarding-ready-status"
            />
          }
        />
        <ListRow
          title={t("driver.onboarding.ready.vehicle")}
          trailing={
            <Text variant="bodyStrong">
              {assignment?.vehicle_plate ?? assignment?.vehicle_id ?? state?.assigned_vehicle_id ?? t("common.notAvailable")}
            </Text>
          }
          testID="onboarding-ready-vehicle"
        />
      </Card>

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button
          onPress={onComplete}
          icon={<Icon name="power_settings_new" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
          label={t("driver.onboarding.ready.startDriving")}
          testID="onboarding-ready-start"
        />
      </View>
    </ScrollView>
  )
}
