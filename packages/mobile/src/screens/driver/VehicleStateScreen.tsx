// packages/mobile/src/screens/driver/VehicleStateScreen.tsx
//
// Driver "My Vehicle (Live)" (flows.md B.x, spec `driver_my_vehicle_live`). Shows the asset header
// with its N5 display state, Fuel/DEF gauges, an odometer metric block, upcoming service items, the
// assigned trailer and the quick-action row.
//
// TELEMETRY: gauge/odometer/engine-hour/service/trailer values come from the `VehicleState` feed
// payload (`fuel_level_pct`, `def_level_pct`, `odometer_km`, `engine_hours`, `battery_volts`,
// `estimated_range_km`, `trailer`, `upcoming_service`). All fields are optional, so each block
// falls back gracefully and the placeholder notice renders only when telemetry is missing.
// UNITS: the feed is metric, so this screen renders metric strings only (km / kg / °C / %).

import React from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge } from "@/design/components/StatusBadge"
import { theme, displayStateStyle } from "@/design/theme"
import { t } from "@/core/i18n"
import type { VehicleState } from "@/core/driver/feed"

/** N5 display-state palette key (mirrors the gateway's frozen set). */
type DisplayState = VehicleState["display_state"]

export interface VehicleStateScreenProps {
  vehicle: VehicleState | null
  offline: boolean
  onBack: () => void
  /** Opens the live map for this asset. Falls back to `onBack` when the router does not wire it. */
  onOpenMap?: () => void
  /** Opens the telemetry/detail view. Falls back to `onBack` when unwired. */
  onOpenTelemetry?: () => void
  /** Starts the "report vehicle issue" flow. Falls back to `onBack` when unwired. */
  onReportIssue?: () => void
}

/** Fallback plate/asset label derived from the vehicle id (used when `plate` is absent). */
function plateFor(vehicle: VehicleState): string {
  return `#${vehicle.vehicle_id.slice(0, 8).toUpperCase()}`
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US")
}

/** Maps a known service label key onto its i18n string, falling back to the raw label. */
function serviceLabel(label: string): string {
  const key = `driver.vehicle.${label}`
  const translated = t(key)
  return translated === key ? label : translated
}

/** Squared Carbon gauge track + fill (no radius — DESIGN.md squared corners). */
function Gauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <View
      style={{
        height: theme.spacing[3],
        backgroundColor: theme.colors.surfaceContainerHigh,
        overflow: "hidden",
      }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <View style={{ width: `${clamped}%`, height: "100%", backgroundColor: theme.colors.interactive01 }} />
    </View>
  )
}

function GaugeCard({
  icon,
  label,
  percent,
  footerLeft,
  footerRight,
  testID,
}: {
  icon: "local_gas_station" | "water_drop"
  label: string
  percent: number
  footerLeft: string
  footerRight: string
  testID?: string
}) {
  return (
    <Card testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing[3] }}>
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <Icon name={icon} size={theme.sizing.iconMd} color={theme.colors.interactive01} />
          <Text variant="label" color={theme.colors.onSurfaceVariant} style={{ marginLeft: theme.spacing[3] }}>
            {label}
          </Text>
        </View>
        <Text preset="metric">{`${Math.round(percent)}%`}</Text>
      </View>
      <Gauge percent={percent} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing[3] }}>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {footerLeft}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {footerRight}
        </Text>
      </View>
    </Card>
  )
}

export function VehicleStateScreen({
  vehicle,
  offline,
  onBack,
  onOpenMap,
  onOpenTelemetry,
  onReportIssue,
}: VehicleStateScreenProps) {
  const state: DisplayState | null = vehicle ? vehicle.display_state : null
  const stateStyle = state ? displayStateStyle(state) : null

  // Real telemetry off the feed payload; every field is optional, so track what is missing.
  const fuelPct = vehicle?.fuel_level_pct ?? null
  const defPct = vehicle?.def_level_pct ?? null
  const odometerKm = vehicle?.odometer_km ?? null
  const engineHours = vehicle?.engine_hours ?? null
  const batteryVolts = vehicle?.battery_volts ?? null
  const estimatedRangeKm = vehicle?.estimated_range_km ?? null
  const trailer = vehicle?.trailer ?? null
  const service = vehicle?.upcoming_service ?? []
  const telemetryMissing =
    fuelPct == null ||
    defPct == null ||
    odometerKm == null ||
    engineHours == null ||
    batteryVolts == null ||
    estimatedRangeKm == null

  return (
    <ScrollView
      contentContainerStyle={{ padding: theme.spacing[5] }}
      style={{ backgroundColor: theme.colors.ui01 }}
      testID="vehicle-screen"
    >
      <Text preset="heading03">{t("driver.vehicle.title")}</Text>
      <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}>
        {t("driver.vehicle.subtitle")}
      </Text>

      {!vehicle || !stateStyle ? (
        <Card testID="vehicle-empty">
          <Text variant="subtitle">{t("driver.vehicle.unassigned")}</Text>
          <Text variant="body" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.vehicle.unassignedDescription")}
          </Text>
        </Card>
      ) : (
        <>
          {/* Header: plate + display-state badge (N5 palette) */}
          <Card variant="container" accent={stateStyle.bg} testID="vehicle-header">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
                <Text variant="label" color={theme.colors.textSecondary}>
                  {t("driver.vehicle.plate")}
                </Text>
                <Text preset="metric" style={{ marginTop: theme.spacing[1] }}>
                  {vehicle.plate ?? plateFor(vehicle)}
                </Text>
              </View>
              <View style={{ backgroundColor: stateStyle.bg, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[2] }}>
                <Text variant="label" color={stateStyle.fg}>
                  {t(`displayState.${state}`)}
                </Text>
              </View>
            </View>

            {vehicle.driver_name ? (
              <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[3] }}>
                {vehicle.driver_name}
              </Text>
            ) : null}

            {vehicle.latitude != null && vehicle.longitude != null ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing[2] }}>
                <Icon name="location_on" size={theme.sizing.iconSm} color={theme.colors.textSecondary} />
                <Text variant="caption" color={theme.colors.textSecondary} style={{ marginLeft: theme.spacing[2] }}>
                  {`${vehicle.latitude.toFixed(4)}, ${vehicle.longitude.toFixed(4)}`}
                </Text>
              </View>
            ) : (
              <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
                {t("driver.vehicle.noPosition")}
              </Text>
            )}
          </Card>

          {/* Fuel & DEF gauges */}
          <GaugeCard
            testID="vehicle-fuel"
            icon="local_gas_station"
            label={t("driver.vehicle.fuelLevel")}
            percent={fuelPct ?? 0}
            footerLeft={
              estimatedRangeKm != null
                ? t("driver.vehicle.estimatedRangeKm", { km: formatNumber(estimatedRangeKm) })
                : t("driver.vehicle.fuelLevel")
            }
            footerRight={fuelPct != null ? t("driver.vehicle.fuelLevelPct", { pct: Math.round(fuelPct) }) : "—"}
          />
          <GaugeCard
            testID="vehicle-def"
            icon="water_drop"
            label={t("driver.vehicle.defLevel")}
            percent={defPct ?? 0}
            footerLeft={t("driver.vehicle.defLevel")}
            footerRight={defPct != null ? t("driver.vehicle.defLevelPct", { pct: Math.round(defPct) }) : "—"}
          />

          {/* Odometer metric block */}
          <Card testID="vehicle-odometer">
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
              <Icon name="speed" size={theme.sizing.iconLg} color={theme.colors.interactive01} />
              <Text variant="label" color={theme.colors.onSurfaceVariant} style={{ marginLeft: theme.spacing[3] }}>
                {t("driver.vehicle.odometer")}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text preset="metric">
                {odometerKm != null ? t("driver.vehicle.odometerKm", { km: formatNumber(odometerKm) }) : "—"}
              </Text>
            </View>

            <View style={{ marginTop: theme.spacing[4], borderTopWidth: 1, borderTopColor: theme.colors.ui03, paddingTop: theme.spacing[3] }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: theme.spacing[2] }}>
                <Text variant="body" color={theme.colors.textSecondary}>
                  {t("driver.vehicle.engineHours")}
                </Text>
                <Text variant="bodyStrong">{engineHours != null ? formatNumber(engineHours) : "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="body" color={theme.colors.textSecondary}>
                  {t("driver.vehicle.batteryVolts")}
                </Text>
                <Text variant="bodyStrong">{batteryVolts != null ? String(batteryVolts) : "—"}</Text>
              </View>
            </View>
          </Card>

          {/* Upcoming service */}
          {service.length > 0 ? (
            <Card variant="surface" style={{ padding: 0 }} testID="vehicle-service">
              <View style={{ flexDirection: "row", alignItems: "center", padding: theme.spacing[4] }}>
                <Icon name="build" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
                <Text variant="subtitle" style={{ marginLeft: theme.spacing[3] }}>
                  {t("driver.vehicle.upcomingService")}
                </Text>
              </View>
              {service.map((item, index) => (
                <ListRow
                  key={`${item.label}-${index}`}
                  title={serviceLabel(item.label)}
                  subtitle={
                    item.due_in_km != null
                      ? t("driver.vehicle.serviceDueInKm", { km: formatNumber(item.due_in_km) })
                      : undefined
                  }
                  trailing={<Icon name="build" size={theme.sizing.iconSm} color={theme.colors.textSecondary} />}
                />
              ))}
            </Card>
          ) : null}

          {/* Assigned trailer */}
          {trailer ? (
            <Card testID="vehicle-trailer">
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
                <Icon name="rv_hookup" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
                <Text variant="subtitle" style={{ marginLeft: theme.spacing[3] }}>
                  {t("driver.vehicle.assignedTrailer")}
                </Text>
              </View>
              <Text variant="bodyStrong">{trailer.code ?? "—"}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing[2] }}>
                <Text variant="caption" color={theme.colors.textSecondary}>
                  {t("driver.vehicle.trailerLoadKg", {
                    kg: trailer.load_kg != null ? formatNumber(trailer.load_kg) : "—",
                  })}
                </Text>
                <Text variant="caption" color={theme.colors.textSecondary}>
                  {trailer.temp_c != null
                    ? t("driver.vehicle.trailerTempC", { temp: formatNumber(trailer.temp_c) })
                    : t("driver.vehicle.trailerTempAmbient")}
                </Text>
              </View>
            </Card>
          ) : null}

          {telemetryMissing ? (
            <Text variant="caption" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[4] }}>
              {t("driver.vehicle.placeholderNotice")}
            </Text>
          ) : null}
        </>
      )}

      {offline ? (
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Icon name="cloud_off" size={theme.sizing.iconSm} color={theme.colors.supportWarning} />
          <StatusBadge tone="warning" label={t("driver.vehicle.offlineMapNotice")} testID="vehicle-offline" />
        </View>
      ) : null}

      {/* Action row */}
      <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            onPress={onOpenTelemetry ?? onBack}
            icon={<Icon name="speed" size={theme.sizing.iconMd} color={theme.colors.interactive01} />}
            testID="vehicle-action-telemetry"
          >
            {t("driver.vehicle.viewTelemetry")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            onPress={onOpenMap ?? onBack}
            icon={<Icon name="map" size={theme.sizing.iconMd} color={theme.colors.interactive01} />}
            testID="vehicle-action-map"
          >
            {t("driver.vehicle.viewMap")}
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            onPress={onReportIssue ?? onBack}
            icon={<Icon name="report_problem" size={theme.sizing.iconMd} color={theme.colors.interactive01} />}
            testID="vehicle-action-report"
          >
            {t("driver.vehicle.reportIssue")}
          </Button>
        </View>
      </View>

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button variant="ghost" onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>
    </ScrollView>
  )
}
