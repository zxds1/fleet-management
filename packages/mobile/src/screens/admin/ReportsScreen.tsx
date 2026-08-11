// packages/mobile/src/screens/admin/ReportsScreen.tsx
//
// Analytics & reports hub (spec `analytics_reporting`). Shows the operational headline counters from
// `GET /reports/analytics` as stat cards, two illustrative visualisations (utilisation heatmap,
// cost-by-vehicle bar) and a link into the detailed fuel-efficiency screen. Reuses ChartCard.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatCard } from "@/design/components/StatCard"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { ChartCard } from "@/design/components/ChartCard"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { AnalyticsReport } from "@/core/admin"

export interface ReportsScreenProps {
  services: Services
  onBack: () => void
  /** Opens the detailed fuel-efficiency breakdown. */
  onOpenFuel: () => void
}

const HEAT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const HEAT_HOURS = ["06", "09", "12", "15", "18"]

function mockHeat(): number[][] {
  return HEAT_HOURS.map((_, h) =>
    HEAT_DAYS.map((_, d) => Math.round(40 + 50 * Math.sin((h + 1) / 2) * Math.cos((d + 1) / 3))),
  )
}

export function ReportsScreen({ services, onBack, onOpenFuel }: ReportsScreenProps) {
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const data = await services.admin.reports.loadAnalytics()
      setAnalytics(data)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-reports">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <Text preset="heading03">{t("admin.reports.title")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {error ? (
        <ErrorState error={error} onAction={() => void refresh()} />
      ) : null}

      {loading ? (
        <Card variant="container">
          <Skeleton width="100%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={20} />
        </Card>
      ) : analytics ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2], marginBottom: theme.spacing[3] }}>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statActiveFleet")} value={String(analytics.active_fleet)} tone="info" testID="reports-active-fleet" />
            </View>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statOpenAccidents")} value={String(analytics.open_accidents)} tone="danger" testID="reports-open-accidents" />
            </View>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statPendingDvir")} value={String(analytics.pending_dvir)} tone="warning" testID="reports-pending-dvir" />
            </View>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statExpiringDocs")} value={String(analytics.expiring_docs)} tone="warning" testID="reports-expiring-docs" />
            </View>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statFuelSpend")} value={`${analytics.fuel_spend_30d}`} tone="info" testID="reports-fuel-spend" />
            </View>
            <View style={{ width: "50%", padding: theme.spacing[2] }}>
              <StatCard label={t("admin.reports.statOpenAnomalies")} value={String(analytics.anomalies_open)} tone="danger" testID="reports-open-anomalies" />
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2], marginBottom: theme.spacing[3] }}>
            <View style={{ width: theme.isTablet ? "50%" : "100%", padding: theme.spacing[2] }}>
              <ChartCard title={t("admin.reports.utilisation")} type="heatmap" heatmap={{ days: HEAT_DAYS, hours: HEAT_HOURS, values: mockHeat() }} testID="reports-utilisation" />
            </View>
            <View style={{ width: theme.isTablet ? "50%" : "100%", padding: theme.spacing[2] }}>
              <ChartCard title={t("admin.reports.costByVehicle")} type="bar" bar={{ labels: HEAT_HOURS, values: [30, 55, 42, 60, 38] }} testID="reports-cost" />
            </View>
          </View>

          <Card variant="container" testID="reports-fuel-link">
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
              <Icon name="local_gas_station" size={theme.sizing.iconLg} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text preset="heading01">{t("admin.reports.fuelLinkTitle")}</Text>
                <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                  {t("admin.reports.fuelLinkHelp")}
                </Text>
              </View>
              <Button variant="secondary" fullWidth={false} onPress={onOpenFuel} testID="reports-open-fuel">
                {t("admin.reports.openFuel")}
              </Button>
            </View>
          </Card>
        </>
      ) : (
        <EmptyState title={t("admin.reports.empty")} description={t("admin.reports.emptyDescription")} icon={<Icon name="bar_chart" size={32} color={theme.colors.outline} />} />
      )}
    </ScrollView>
  )
}
