// packages/mobile/src/screens/driver/VehicleIssueScreen.tsx
//
// Driver "report vehicle issue" (spec `report_vehicle_issue`). Reached from the quick-action row on
// `VehicleStateScreen`, this is the NON-accident defect path: a mechanical/electrical/tyre/body
// fault the driver wants triaged by maintenance. Collisions and the B17 SOS still go to
// `AccidentScreen`.
//
// Presentational + local validation only: the handler receives the assembled payload and the router
// maps it onto `services.vehicleIssue.report(vehicleId, …)`.
//
// DESIGN.md: squared corners, no radius, 48dp touch targets. The category grid and the urgency row
// are built from `Button` + `Card` rather than a new design-system component — a selection grid is a
// layout of existing primitives, not a new primitive.

import React, { useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon, type IconName } from "@/design/components/Icon"
import { PhotoCapture, type CapturedPhoto } from "@/design/components/PhotoCapture"
import { ErrorState } from "@/design/components/ErrorState"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { AppError } from "@/core/error"
import {
  VEHICLE_ISSUE_CATEGORIES,
  VEHICLE_ISSUE_SEVERITIES,
  type VehicleIssueCategory,
  type VehicleIssueSeverity,
} from "@/core/driver/vehicleIssue"

/** Icon per category, using the curated Material Symbols vocabulary in `design/tokens.ts`. */
const CATEGORY_ICON: Record<VehicleIssueCategory, IconName> = {
  MECHANICAL: "build",
  ELECTRICAL: "bolt",
  TYRE: "tire_repair",
  BODY: "directions_car",
  OTHER: "more_horiz",
}

/** Severity accent (Carbon support palette): low = info, medium = warning, high = error. */
function severityColor(severity: VehicleIssueSeverity): string {
  if (severity === "HIGH") return theme.colors.supportError
  if (severity === "MEDIUM") return theme.colors.supportWarning
  return theme.colors.interactive01
}

export interface VehicleIssueSubmitPayload {
  category: VehicleIssueCategory
  severity: VehicleIssueSeverity
  description: string
  photo: CapturedPhoto | null
}

export interface VehicleIssueScreenProps {
  /** Active vehicle id. Empty string when dispatch has not assigned one yet. */
  vehicleId: string
  /** Plate shown in the "active vehicle" header; falls back to the id when absent. */
  vehiclePlate?: string | null
  submitting: boolean
  error?: AppError
  onSubmit: (payload: VehicleIssueSubmitPayload) => void
  onCancel: () => void
}

export function VehicleIssueScreen({
  vehicleId,
  vehiclePlate,
  submitting,
  error,
  onSubmit,
  onCancel,
}: VehicleIssueScreenProps) {
  const [category, setCategory] = useState<VehicleIssueCategory | null>(null)
  const [severity, setSeverity] = useState<VehicleIssueSeverity>("LOW")
  const [description, setDescription] = useState("")
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [localError, setLocalError] = useState<string>()

  const submit = () => {
    if (!category) return setLocalError(t("driver.vehicleIssue.categoryRequired"))
    if (!description.trim()) return setLocalError(t("driver.vehicleIssue.descriptionRequired"))
    setLocalError(undefined)
    onSubmit({ category, severity, description: description.trim(), photo })
  }

  // Without an assigned vehicle there is nothing to report against; the driver is told why rather
  // than being shown a form whose submit can only fail.
  if (!vehicleId) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="vehicle-issue-screen">
        <Text preset="heading03">{t("driver.vehicleIssue.title")}</Text>
        <Card style={{ marginTop: theme.spacing[4] }} testID="vehicle-issue-no-vehicle">
          <Text variant="subtitle">{t("driver.vehicleIssue.noVehicle")}</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.vehicleIssue.noVehicleDescription")}
          </Text>
        </Card>
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button variant="ghost" onPress={onCancel}>
            {t("common.back")}
          </Button>
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: theme.spacing[5] }}
      style={{ backgroundColor: theme.colors.ui01 }}
      testID="vehicle-issue-screen"
    >
      <Text preset="heading03">{t("driver.vehicleIssue.title")}</Text>
      <Text
        variant="body"
        color={theme.colors.textSecondary}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.vehicleIssue.subtitle")}
      </Text>

      {/* Active vehicle header (spec: left-accented plate block) */}
      <Card variant="container" accent={theme.colors.interactive01} testID="vehicle-issue-vehicle">
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Icon name="local_shipping" size={theme.sizing.iconMd} color={theme.colors.interactive01} />
          <View style={{ marginLeft: theme.spacing[3], flex: 1 }}>
            <Text variant="label" color={theme.colors.textSecondary}>
              {t("driver.vehicleIssue.activeVehicle")}
            </Text>
            <Text variant="bodyStrong" style={{ marginTop: theme.spacing[1] }}>
              {vehiclePlate ?? `#${vehicleId.slice(0, 8).toUpperCase()}`}
            </Text>
          </View>
        </View>
      </Card>

      {/* Category grid */}
      <Card style={{ marginTop: theme.spacing[4] }} testID="vehicle-issue-categories">
        <Text variant="label" color={theme.colors.textSecondary}>
          {t("driver.vehicleIssue.categoryLabel")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing[3] }}>
          {VEHICLE_ISSUE_CATEGORIES.map((c) => (
            <View key={c} style={{ width: "50%", padding: theme.spacing[1] }}>
              <Button
                variant={category === c ? "primary" : "secondary"}
                onPress={() => setCategory(c)}
                icon={
                  <Icon
                    name={CATEGORY_ICON[c]}
                    size={theme.sizing.iconMd}
                    color={category === c ? theme.colors.ui01 : theme.colors.interactive01}
                  />
                }
                testID={`vehicle-issue-category-${c}`}
                accessibilityLabel={t(`driver.vehicleIssue.category.${c}`)}
              >
                {t(`driver.vehicleIssue.category.${c}`)}
              </Button>
            </View>
          ))}
        </View>
      </Card>

      {/* Urgency */}
      <Card style={{ marginTop: theme.spacing[4] }} testID="vehicle-issue-severities">
        <Text variant="label" color={theme.colors.textSecondary}>
          {t("driver.vehicleIssue.severityLabel")}
        </Text>
        <View style={{ flexDirection: "row", marginTop: theme.spacing[3], gap: theme.spacing[2] }}>
          {VEHICLE_ISSUE_SEVERITIES.map((s) => (
            <View
              key={s}
              style={{
                flex: 1,
                borderLeftWidth: theme.spacing[1],
                borderLeftColor: severity === s ? severityColor(s) : "transparent",
              }}
            >
              <Button
                variant={severity === s ? "primary" : "secondary"}
                onPress={() => setSeverity(s)}
                testID={`vehicle-issue-severity-${s}`}
              >
                {t(`driver.vehicleIssue.severity.${s}`)}
              </Button>
            </View>
          ))}
        </View>
        <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[3] }}>
          {t("driver.vehicleIssue.severityHint")}
        </Text>
      </Card>

      {/* Description + optional evidence */}
      <View style={{ marginTop: theme.spacing[4] }}>
        <Input
          label={t("driver.vehicleIssue.descriptionLabel")}
          placeholder={t("driver.vehicleIssue.descriptionPlaceholder")}
          value={description}
          onChangeText={setDescription}
          multiline
          required
          testID="vehicle-issue-description"
        />
        <PhotoCapture
          label={t("driver.vehicleIssue.photoLabel")}
          value={photo}
          onCapture={setPhoto}
          onRemove={() => setPhoto(null)}
          testID="vehicle-issue-photo"
        />
      </View>

      {localError ? (
        <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }} testID="vehicle-issue-error">
          {localError}
        </Text>
      ) : null}
      {error ? <ErrorState error={error} /> : null}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button
          loading={submitting}
          onPress={submit}
          icon={<Icon name="send" size={theme.sizing.iconMd} color={theme.colors.ui01} />}
          testID="vehicle-issue-submit"
        >
          {t("driver.vehicleIssue.submit")}
        </Button>
      </View>
      <View style={{ marginTop: theme.spacing[3] }}>
        <Button variant="ghost" onPress={onCancel}>
          {t("common.cancel")}
        </Button>
      </View>
    </ScrollView>
  )
}
