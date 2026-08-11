// packages/mobile/src/screens/admin/FuelEfficiencyScreen.tsx
//
// Fuel efficiency & anomalies (spec `fuel_efficiency_anomalies`). Reads the per-vehicle breakdown from
// `GET /reports/fuel-efficiency` and surfaces the worst performers first (highest L/100km). Rows are
// tappable to drill into the vehicle on the Live Map.

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatCard } from "@/design/components/StatCard"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { DataTable, type DataTableColumn } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { FuelEfficiencyVehicle, FuelEfficiencyReport } from "@/core/admin"

export interface FuelEfficiencyScreenProps {
  services: Services
  onBack: () => void
  /** Drill into a vehicle on the Live Map. */
  onSelectVehicle?: (vehicleId: string) => void
}

/** Higher L/100km is worse; we flag the upper third of the fleet. */
function efficiencyTone(lPer100: number, fleetWorst: number): BadgeTone {
  if (lPer100 <= 0) return "neutral"
  const pct = lPer100 / (fleetWorst || 1)
  if (pct >= 0.9) return "danger"
  if (pct >= 0.75) return "warning"
  if (pct >= 0.6) return "info"
  return "success"
}

export function FuelEfficiencyScreen({ services, onBack, onSelectVehicle }: FuelEfficiencyScreenProps) {
  const [report, setReport] = useState<FuelEfficiencyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const data = await services.admin.reports.loadFuelEfficiency()
      setReport(data)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows: FuelEfficiencyVehicle[] = useMemo(
    () => (report ? [...report.per_vehicle].sort((a, b) => (b.efficiency ?? 0) - (a.efficiency ?? 0)) : []),
    [report],
  )

  const fleetWorst = useMemo(
    () => rows.reduce((max, r) => Math.max(max, r.efficiency ?? 0), 0),
    [rows],
  )
  const flagged = useMemo(
    () => rows.filter((r) => r.efficiency != null && fleetWorst > 0 && r.efficiency >= 0.9 * fleetWorst).length,
    [rows, fleetWorst],
  )

  const columns: DataTableColumn<FuelEfficiencyVehicle>[] = [
    {
      key: "vehicle",
      header: t("admin.reports.fuelColVehicle"),
      flex: 1.5,
      render: (r) => (
        <Text preset="bodyStrong" color={theme.colors.interactive01}>
          {r.vehicle_plate ?? t("common.notAvailable")}
        </Text>
      ),
    },
    {
      key: "fuel",
      header: t("admin.reports.fuelColFuel"),
      flex: 1.2,
      align: "right",
      render: (r) => <Text preset="body02">{Math.round(r.litres)}</Text>,
    },
    {
      key: "cost",
      header: t("admin.reports.fuelColCost"),
      flex: 1.2,
      align: "right",
      render: (r) => <Text preset="body02">{r.cost.toFixed(2)}</Text>,
    },
    {
      key: "efficiency",
      header: t("admin.reports.fuelColEfficiency"),
      flex: 1.2,
      align: "right",
      render: (r) => (
        <Text preset="bodyStrong">{r.efficiency != null ? r.efficiency.toFixed(1) : t("common.notAvailable")}</Text>
      ),
    },
    {
      key: "status",
      header: t("admin.reports.fuelColStatus"),
      flex: 1.2,
      render: (r) => (
        <StatusBadge
          label={
            r.efficiency == null
              ? t("admin.reports.fuelUnknown")
              : r.efficiency >= 0.9 * fleetWorst
                ? t("admin.reports.fuelFlagged")
                : t("admin.reports.fuelOk")
          }
          tone={r.efficiency == null ? "neutral" : efficiencyTone(r.efficiency, fleetWorst)}
        />
      ),
    },
  ]

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-fuel">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <Text preset="heading03">{t("admin.reports.fuelTitle")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2], marginBottom: theme.spacing[3] }}>
        <View style={{ width: "50%", padding: theme.spacing[2] }}>
          <StatCard
            label={t("admin.reports.fuelFleetAvg")}
            value={report?.avg_efficiency_l_per_100km != null ? report.avg_efficiency_l_per_100km.toFixed(1) : t("common.notAvailable")}
            tone="info"
            testID="fuel-fleet-avg"
          />
        </View>
        <View style={{ width: "50%", padding: theme.spacing[2] }}>
          <StatCard
            label={t("admin.reports.fuelFlagged")}
            value={String(flagged)}
            tone={flagged > 0 ? "danger" : "success"}
            testID="fuel-flagged"
          />
        </View>
      </View>

      {error ? (
        <ErrorState error={error} onAction={() => void refresh()} />
      ) : null}

      <Text preset="title" style={{ marginBottom: theme.spacing[3] }}>
        {t("admin.reports.fuelBreakdown")}
      </Text>
      {loading ? (
        <Card variant="container">
          <Skeleton width="100%" height={16} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="90%" height={16} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={16} />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("admin.reports.fuelEmpty")}
          description={t("admin.reports.fuelEmptyDescription")}
          icon={<Icon name="local_gas_station" size={32} color={theme.colors.outline} />}
        />
      ) : (
        <Card variant="container" style={{ padding: 0 }}>
          <DataTable
            testID="fuel-table"
            columns={columns}
            rows={rows}
            onRowPress={
              onSelectVehicle
                ? (r) => {
                    // `/reports/fuel-efficiency` only projects the plate, so resolve it to the
                    // real vehicle id before navigating; a plate is not a valid `vehicleId`.
                    const match = services.admin.dashboard.vehicles.find(
                      (v) => v.vehicle_id === r.vehicle_plate,
                    )
                    const byRecord = services.admin.vehicles.vehicles.find(
                      (v) => v.license_plate === r.vehicle_plate,
                    )
                    const vehicleId = byRecord?.id ?? match?.vehicle_id
                    if (vehicleId) onSelectVehicle(vehicleId)
                  }
                : undefined
            }
          />
        </Card>
      )}
    </ScrollView>
  )
}
