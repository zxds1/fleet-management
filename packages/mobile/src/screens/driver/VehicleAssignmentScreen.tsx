// packages/mobile/src/screens/driver/VehicleAssignmentScreen.tsx
//
// Onboarding step 3 (spec `driver_onboarding_vehicle_assignment`). The spec shows a picker, but the
// backend assigns the vehicle server-side: `GET /drivers/me/assignment` returns the single vehicle
// dispatch allocated (or `null`). The screen therefore renders that one assignment card and asks
// the driver to accept it, with an explicit empty state + refresh while dispatch has not decided.

import React, { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Icon } from "@/design/components/Icon"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { VehicleAssignment } from "@/core/driver/onboarding"
import { OnboardingProgress } from "./OnboardingProgress"

export interface VehicleAssignmentScreenProps {
  services: Services
  onNext: () => void
}

function toneFor(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
    case "ASSIGNED":
    case "AVAILABLE":
      return "success"
    case "PENDING":
      return "info"
    case "MAINTENANCE":
      return "warning"
    default:
      return "neutral"
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleDateString()
}

export function VehicleAssignmentScreen({ services, onNext }: VehicleAssignmentScreenProps) {
  const [assignment, setAssignment] = useState<VehicleAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAssignment(await services.onboarding.getAssignment())
      setError(undefined)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <View style={{ flex: 1, padding: theme.spacing[5], gap: theme.spacing[4] }} testID="onboarding-vehicle-loading">
        <Skeleton width="60%" height={28} />
        <Skeleton height={140} />
        <Skeleton height={48} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="onboarding-vehicle-screen">
      <OnboardingProgress step={3} />

      <Text preset="heading03" style={{ marginTop: theme.spacing[4] }}>
        {t("driver.onboarding.vehicle.title")}
      </Text>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[5] }}
      >
        {t("driver.onboarding.vehicle.subtitle")}
      </Text>

      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="onboarding-vehicle-error" />
        </View>
      ) : null}

      {assignment ? (
        <>
          <Card
            variant="container"
            accent={theme.colors.primary}
            title={t("driver.onboarding.vehicle.vehicleAssigned")}
            trailing={
              <StatusBadge
                label={assignment.status ?? t("common.notAvailable")}
                tone={toneFor(assignment.status)}
                testID="onboarding-vehicle-status"
              />
            }
            testID="onboarding-vehicle-card"
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[4], marginBottom: theme.spacing[3] }}>
              <Icon name="local_shipping" size={32} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="label" color={theme.colors.secondary}>
                  {t("driver.onboarding.vehicle.plate")}
                </Text>
                <Text preset="heading02" testID="onboarding-vehicle-plate">
                  {assignment.vehicle_plate ?? assignment.vehicle_id}
                </Text>
              </View>
            </View>

            <ListRow
              title={t("driver.onboarding.vehicle.assignedDate")}
              trailing={<Text variant="bodyStrong">{formatDate(assignment.assigned_date)}</Text>}
            />
            <ListRow
              title={t("driver.onboarding.vehicle.status")}
              trailing={<Text variant="bodyStrong">{assignment.status ?? t("common.notAvailable")}</Text>}
            />
          </Card>

          <Button
            onPress={onNext}
            icon={<Icon name="check" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
            label={t("driver.onboarding.vehicle.accept")}
            testID="onboarding-vehicle-accept"
          />
        </>
      ) : (
        <EmptyState
          icon={<Icon name="local_shipping" size={32} color={theme.colors.onSurfaceVariant} />}
          title={t("driver.onboarding.vehicle.pendingTitle")}
          description={t("driver.onboarding.vehicle.pendingDescription")}
          actionLabel={t("driver.onboarding.vehicle.refresh")}
          onAction={() => void load()}
          testID="onboarding-vehicle-empty"
        />
      )}
    </ScrollView>
  )
}
