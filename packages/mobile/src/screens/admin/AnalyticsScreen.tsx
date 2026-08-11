// packages/mobile/src/screens/admin/AnalyticsScreen.tsx
//
// Hierarchical analytics with drill-down (spec `analytics_reporting`). One screen serves all three
// viewer roles; the tree it exposes is decided by the authenticated principal's roles, never by a
// prop, so the UI can never offer a drill-down the server would reject:
//
//   ADMIN         company → invited admin (manager) → vehicle | driver
//   FLEET_MANAGER manager (self, scoped) → vehicle | driver
//   DRIVER        me (personal KPIs only — no drill-down to anyone else)
//
// Navigation is local state (`view` + `selectedId` + a breadcrumb stack) rather than router screens,
// so a drill-down never loses the parent's loaded payload and "back" is always one pop.
//
// Replaces the previous mocked utilisation heatmap: the bar chart is now driven by real per-entity
// distance/fuel figures returned by `/analytics/*`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import {
  flattenKpis,
  resolveViewerRole,
  type AnalyticsKpis,
  type AnalyticsView,
  type CompanyAnalytics,
  type DriverAnalytics,
  type ManagerAnalytics,
  type VehicleAnalytics,
} from "@/core/analytics"

/** Which level of the hierarchy is on screen. */
export interface AnalyticsScreenProps {
  services: Services
  onBack: () => void
  /** Opens the detailed fuel-efficiency breakdown (kept from the previous reports hub). */
  onOpenFuel?: () => void
}

interface Crumb {
  view: AnalyticsView
  id?: string
  label: string
}

/**
 * Resolves the viewer's analytics scope from the session principal — see `resolveViewerRole` in
 * `core/analytics.ts` (kept there so it is unit-testable without the RN transform).
 */
/** `1234.5` → `"1,235"`; null/undefined → an em-dash so an absent field reads as "no data". */
function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return `${Math.round(v)}%`
}

/** The six KPI stat cards shared by every level. Cards whose metric is absent still render "—". */
function KpiGrid({ kpis, prefix }: { kpis: AnalyticsKpis; prefix: string }): React.ReactElement {
  const cells: { key: string; label: string; value: string; tone: "info" | "warning" | "danger" | "success" }[] = [
    { key: "vehicles", label: t("admin.analytics.vehicles"), value: num(kpis.vehicles), tone: "info" },
    { key: "drivers", label: t("admin.analytics.drivers"), value: num(kpis.drivers), tone: "info" },
    { key: "distance", label: t("admin.analytics.distance"), value: num(kpis.distanceKm), tone: "success" },
    { key: "fuel-cost", label: t("admin.analytics.fuelCost"), value: num(kpis.fuelCost), tone: "warning" },
    { key: "anomalies", label: t("admin.analytics.anomalies"), value: num(kpis.anomalies), tone: "danger" },
    { key: "utilisation", label: t("admin.analytics.utilisation"), value: pct(kpis.utilisationPct), tone: "info" },
  ]
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        marginHorizontal: -theme.spacing[2],
        marginBottom: theme.spacing[3],
      }}
    >
      {cells.map((c) => (
        <View key={c.key} style={{ width: "50%", padding: theme.spacing[2] }}>
          <StatCard label={c.label} value={c.value} tone={c.tone} testID={`${prefix}-${c.key}`} />
        </View>
      ))}
    </View>
  )
}

/** A tappable drill-down row. `onPress` is omitted for leaf levels, which renders it inert. */
function DrillRow({
  title,
  subtitle,
  onPress,
  testID,
}: {
  title: string
  subtitle: string
  onPress?: () => void
  testID: string
}): React.ReactElement {
  return (
    <Card variant="surface" onPress={onPress} testID={testID} accessibilityLabel={title}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Text preset="bodyStrong">{title}</Text>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
            {subtitle}
          </Text>
        </View>
        {onPress ? (
          <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
        ) : null}
      </View>
    </Card>
  )
}

export function AnalyticsScreen({ services, onBack, onOpenFuel }: AnalyticsScreenProps) {
  const viewer = useMemo(
    () => resolveViewerRole(services.session.principal?.roles as readonly string[] | undefined),
    [services],
  )
  // A manager starts at their own scoped node; a driver at their personal one. Only an admin gets
  // the company root.
  const rootView: AnalyticsView = viewer === "admin" ? "company" : viewer === "manager" ? "manager" : "driver"

  const [view, setView] = useState<AnalyticsView>(rootView)
  // A manager's root node is themselves, so the id is seeded from the principal at mount rather than
  // in an effect: resolving it a commit later would render one frame of the "no analytics" empty
  // state, and would strand the screen there entirely if the principal had no `userId`.
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    viewer === "manager" ? services.session.principal?.userId : undefined,
  )
  const [stack, setStack] = useState<Crumb[]>([])

  const [company, setCompany] = useState<CompanyAnalytics | null>(null)
  const [manager, setManager] = useState<ManagerAnalytics | null>(null)
  const [vehicle, setVehicle] = useState<VehicleAnalytics | null>(null)
  const [driver, setDriver] = useState<DriverAnalytics | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()

  /**
   * Monotonic request generation. Drilling changes `view`/`selectedId` synchronously while a fetch
   * may still be in flight, so every response checks it is still the newest before touching state —
   * otherwise a slow parent response could land after (and overwrite) the node the user drilled into.
   */
  const generation = useRef(0)

  /**
   * Loads the payload for the current node. `getMine()` is used for the driver's own view and for a
   * manager's own root (no id yet); an explicit id always uses the addressed endpoint.
   */
  const refresh = useCallback(async () => {
    const gen = ++generation.current
    const isCurrent = () => gen === generation.current
    setError(undefined)
    setLoading(true)
    try {
      const svc = services.admin.analytics
      if (view === "company") {
        const data = await svc.getCompany()
        if (isCurrent()) setCompany(data)
      } else if (view === "manager") {
        const data = selectedId ? await svc.getManager(selectedId) : null
        if (isCurrent()) setManager(data)
      } else if (view === "vehicle") {
        const data = selectedId ? await svc.getVehicle(selectedId) : null
        if (isCurrent()) setVehicle(data)
      } else {
        // Driver level: someone else's driver node when an id is selected, otherwise "my analytics".
        const data = selectedId ? await svc.getDriver(selectedId) : await svc.getMine()
        if (isCurrent()) setDriver(data)
      }
    } catch (e) {
      if (isCurrent()) setError(fromUnknown(e))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [services, view, selectedId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Pushes the node being left onto the breadcrumb stack and moves to `next`. Guards on `id` so a
   * row whose entity id the backend omitted can never navigate to an unloadable, unrecoverable node.
   */
  const drillTo = (next: AnalyticsView, id: string | null | undefined, fromLabel: string) => {
    if (!id) return
    setStack((s) => [...s, { view, id: selectedId, label: fromLabel }])
    setView(next)
    setSelectedId(id)
  }

  const popOrBack = () => {
    const prev = stack[stack.length - 1]
    if (!prev) {
      onBack()
      return
    }
    setStack((s) => s.slice(0, -1))
    setView(prev.view)
    setSelectedId(prev.id)
  }

  const titleFor = (): string => {
    if (view === "company") return t("admin.analytics.companyAnalytics")
    if (view === "manager") {
      return viewer === "manager" && stack.length === 0
        ? t("admin.analytics.myAnalytics")
        : (manager?.full_name ?? manager?.email ?? t("admin.analytics.managerAnalytics"))
    }
    if (view === "vehicle") return vehicle?.plate ?? t("admin.analytics.vehicleAnalytics")
    return selectedId
      ? (driver?.name ?? t("admin.analytics.driverAnalytics"))
      : t("admin.analytics.myAnalytics")
  }

  const breadcrumb = stack.length > 0 ? stack.map((c) => c.label).join(" › ") : undefined

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-analytics">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{titleFor()}</Text>
          {breadcrumb ? (
            <Text
              preset="caption"
              color={theme.colors.onSurfaceVariant}
              style={{ marginTop: theme.spacing[1] }}
              testID="analytics-breadcrumb"
            >
              {breadcrumb}
            </Text>
          ) : null}
        </View>
        <Button variant="ghost" fullWidth={false} onPress={popOrBack} testID="analytics-back">
          {t("common.back")}
        </Button>
      </View>

      {error ? <ErrorState error={error} onAction={() => void refresh()} testID="analytics-error" /> : null}

      {loading ? (
        <Card variant="container" testID="analytics-loading">
          <Skeleton width="100%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="60%" height={20} />
        </Card>
      ) : view === "company" ? (
        <CompanyView
          company={company}
          onDrillManager={(m) => drillTo("manager", m.user_id, t("admin.analytics.companyAnalytics"))}
          onOpenFuel={onOpenFuel}
        />
      ) : view === "manager" ? (
        <ManagerView
          manager={manager}
          onDrillVehicle={(v) => drillTo("vehicle", v.vehicle_id, titleFor())}
          onDrillDriver={(d) => drillTo("driver", d.driver_id, titleFor())}
        />
      ) : view === "vehicle" ? (
        <LeafView
          kpis={vehicle ? flattenKpis(vehicle) : null}
          prefix="analytics-vehicle"
          emptyTitle={t("admin.analytics.empty")}
        />
      ) : (
        <LeafView
          kpis={driver ? flattenKpis(driver) : null}
          prefix="analytics-driver"
          emptyTitle={t("admin.analytics.empty")}
          extra={
            driver
              ? [{ label: t("admin.analytics.shifts"), value: num(driver.shifts) }]
              : undefined
          }
        />
      )}
    </ScrollView>
  )
}

/** ADMIN root: company KPIs, a real (non-mocked) distance-by-manager bar, and the manager roster. */
function CompanyView({
  company,
  onDrillManager,
  onOpenFuel,
}: {
  company: CompanyAnalytics | null
  onDrillManager: (m: NonNullable<CompanyAnalytics["managers"]>[number]) => void
  onOpenFuel?: () => void
}): React.ReactElement {
  if (!company) {
    return (
      <EmptyState
        title={t("admin.analytics.empty")}
        description={t("admin.analytics.emptyDescription")}
        icon={<Icon name="bar_chart" size={32} color={theme.colors.outline} />}
        testID="analytics-empty"
      />
    )
  }
  const managers = (company.managers ?? []).filter((m) => !!m)
  // Real data replaces the previously-mocked heatmap: distance per invited admin.
  const bar = {
    labels: managers.map((m) => m.full_name ?? m.email ?? "—"),
    values: managers.map((m) => flattenKpis(m).distanceKm ?? 0),
  }

  return (
    <>
      <KpiGrid kpis={flattenKpis(company)} prefix="analytics-company" />

      {managers.length > 0 ? (
        <View style={{ marginBottom: theme.spacing[3] }}>
          <ChartCard
            title={t("admin.analytics.distanceByManager")}
            type="bar"
            bar={bar}
            testID="analytics-distance-chart"
          />
        </View>
      ) : null}

      <Text preset="heading01" style={{ marginBottom: theme.spacing[3] }}>
        {t("admin.analytics.managers")}
      </Text>
      {managers.length === 0 ? (
        <EmptyState
          title={t("admin.analytics.noManagers")}
          description={t("admin.analytics.noManagersDescription")}
          icon={<Icon name="group" size={32} color={theme.colors.outline} />}
          testID="analytics-no-managers"
        />
      ) : (
        managers.map((m, i) => {
          const k = flattenKpis(m)
          return (
            <DrillRow
              key={m.user_id ?? `manager-${i}`}
              title={m.full_name ?? m.email ?? t("admin.analytics.managerAnalytics")}
              subtitle={`${t("admin.analytics.vehicles")}: ${num(k.vehicles ?? m.assignedVehicleIds?.length)} · ${t("admin.analytics.drivers")}: ${num(k.drivers ?? m.assignedDriverIds?.length)} · ${t("admin.analytics.anomalies")}: ${num(k.anomalies)}`}
              onPress={m.user_id ? () => onDrillManager(m) : undefined}
              testID={`analytics-manager-${m.user_id ?? i}`}
            />
          )
        })
      )}

      {onOpenFuel ? (
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="secondary" onPress={onOpenFuel} testID="analytics-open-fuel">
            {t("admin.reports.openFuel")}
          </Button>
        </View>
      ) : null}
    </>
  )
}

/** Manager level: their scoped KPIs plus the two rosters they own, each tappable into a leaf. */
function ManagerView({
  manager,
  onDrillVehicle,
  onDrillDriver,
}: {
  manager: ManagerAnalytics | null
  onDrillVehicle: (v: VehicleAnalytics) => void
  onDrillDriver: (d: DriverAnalytics) => void
}): React.ReactElement {
  if (!manager) {
    return (
      <EmptyState
        title={t("admin.analytics.empty")}
        description={t("admin.analytics.emptyDescription")}
        icon={<Icon name="bar_chart" size={32} color={theme.colors.outline} />}
        testID="analytics-empty"
      />
    )
  }
  const vehicles = manager.vehicles ?? []
  const drivers = manager.drivers ?? []

  return (
    <>
      <KpiGrid kpis={flattenKpis(manager)} prefix="analytics-manager" />

      <Text preset="heading01" style={{ marginBottom: theme.spacing[3] }}>
        {t("admin.analytics.vehicles")}
      </Text>
      {vehicles.length === 0 ? (
        <EmptyState
          title={t("admin.analytics.noVehicles")}
          icon={<Icon name="local_shipping" size={32} color={theme.colors.outline} />}
          testID="analytics-no-vehicles"
        />
      ) : (
        vehicles.map((v, i) => (
          <DrillRow
            key={v.vehicle_id ?? `vehicle-${i}`}
            title={v.plate ?? t("admin.analytics.vehicleAnalytics")}
            subtitle={`${t("admin.analytics.distance")}: ${num(v.distanceKm)} · ${t("admin.analytics.fuelCost")}: ${num(v.fuelCost)} · ${t("admin.analytics.utilisation")}: ${pct(v.utilisationPct)}`}
            onPress={v.vehicle_id ? () => onDrillVehicle(v) : undefined}
            testID={`analytics-vehicle-${v.vehicle_id ?? i}`}
          />
        ))
      )}

      <Text preset="heading01" style={{ marginTop: theme.spacing[4], marginBottom: theme.spacing[3] }}>
        {t("admin.analytics.drivers")}
      </Text>
      {drivers.length === 0 ? (
        <EmptyState
          title={t("admin.analytics.noDrivers")}
          icon={<Icon name="group" size={32} color={theme.colors.outline} />}
          testID="analytics-no-drivers"
        />
      ) : (
        drivers.map((d, i) => (
          <DrillRow
            key={d.driver_id ?? `driver-${i}`}
            title={d.name ?? t("admin.analytics.driverAnalytics")}
            subtitle={`${t("admin.analytics.distance")}: ${num(d.distanceKm)} · ${t("admin.analytics.shifts")}: ${num(d.shifts)} · ${t("admin.analytics.anomalies")}: ${num(d.anomalies)}`}
            onPress={d.driver_id ? () => onDrillDriver(d) : undefined}
            testID={`analytics-driver-${d.driver_id ?? i}`}
          />
        ))
      )}
    </>
  )
}

/** Leaf level (vehicle or driver). Terminal: there is nothing further to drill into. */
function LeafView({
  kpis,
  prefix,
  emptyTitle,
  extra,
}: {
  kpis: AnalyticsKpis | null
  prefix: string
  emptyTitle: string
  extra?: { label: string; value: string }[]
}): React.ReactElement {
  if (!kpis) {
    return (
      <EmptyState
        title={emptyTitle}
        description={t("admin.analytics.emptyDescription")}
        icon={<Icon name="bar_chart" size={32} color={theme.colors.outline} />}
        testID="analytics-empty"
      />
    )
  }
  return (
    <>
      <KpiGrid kpis={kpis} prefix={prefix} />
      {extra?.length ? (
        <Card variant="container" testID={`${prefix}-extra`}>
          {extra.map((e) => (
            <View
              key={e.label}
              style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: theme.spacing[2] }}
            >
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {e.label}
              </Text>
              <Text preset="bodyStrong">{e.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  )
}
