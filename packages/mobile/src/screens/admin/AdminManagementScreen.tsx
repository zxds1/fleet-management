// packages/mobile/src/screens/admin/AdminManagementScreen.tsx
//
// Admin management: list every admin/manager in the company and assign VEHICLES + DRIVERS to each
// one via multi-select dropdowns. ADMIN-only surface (the server also scopes it). For each admin a
// row shows their assigned counts and two "assign" affordances that open the picker populated from
// the company's vehicles and drivers.
//
// Binds to `GET /admin/managers` + `POST /admin/managers/{id}/assign` (contract in
// packages/mobile/BACKEND_TODO.md). Both are tolerance-parsed so a partially-built backend degrades
// to an empty state rather than crashing.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { StatusBadge } from "@/design/components/StatusBadge"
import { MultiSelectSheet, type MultiSelectOption } from "@/design/components/MultiSelectSheet"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { AdminSummary } from "@/core/admin"

export interface AdminManagementScreenProps {
  services: Services
  onBack: () => void
}

/** Maps an `AdminSummary` to the picker-selected id arrays. */
function assignedOf(a: AdminSummary): { vehicleIds: string[]; driverIds: string[] } {
  return {
    vehicleIds: a.assigned_vehicle_ids ?? [],
    driverIds: a.assigned_driver_ids ?? [],
  }
}

export function AdminManagementScreen({ services, onBack }: AdminManagementScreenProps) {
  const [managers, setManagers] = useState<AdminSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [busyId, setBusyId] = useState<string>()

  // Vehicle + driver option pools for the pickers (loaded once; the server scopes them to the company).
  const [vehicleOpts, setVehicleOpts] = useState<MultiSelectOption[]>([])
  const [driverOpts, setDriverOpts] = useState<MultiSelectOption[]>([])

  // Which picker is open, and for which admin.
  const [picker, setPicker] = useState<{ adminId: string; kind: "vehicle" | "driver" } | null>(null)
  const [draft, setDraft] = useState<string[]>([])

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const [roster, veh, drv] = await Promise.all([
        services.admin.adminRoster.load(),
        services.admin.vehicles.load(200).then(() => services.admin.vehicles.vehicles),
        services.admin.drivers.load().then(() => services.admin.drivers.drivers),
      ])
      setManagers(roster.managers ?? [])
      setVehicleOpts(
        veh.map((v) => ({ value: v.id, label: v.license_plate, hint: [v.make, v.model].filter(Boolean).join(" ") || undefined })),
      )
      setDriverOpts(
        drv.map((d) => ({ value: d.user_id, label: d.full_name ?? d.phone ?? d.email ?? d.user_id })),
      )
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openPicker = (admin: AdminSummary, kind: "vehicle" | "driver") => {
    const a = assignedOf(admin)
    setDraft(kind === "vehicle" ? a.vehicleIds : a.driverIds)
    setPicker({ adminId: admin.user_id ?? "", kind })
  }

  const closePicker = () => setPicker(null)

  const toggle = (value: string) =>
    setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))

  const commit = async () => {
    if (!picker) return
    const admin = managers.find((m) => m.user_id === picker.adminId)
    if (!admin) return closePicker()
    const a = assignedOf(admin)
    const vehicle_ids = picker.kind === "vehicle" ? draft : a.vehicleIds
    const driver_ids = picker.kind === "driver" ? draft : a.driverIds
    setBusyId(picker.adminId)
    try {
      await services.admin.adminRoster.assign(picker.adminId, { vehicle_ids, driver_ids })
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setBusyId(undefined)
      closePicker()
      await refresh()
    }
  }

  const activeAdmin = picker ? managers.find((m) => m.user_id === picker.adminId) : undefined
  const pickerOptions = picker?.kind === "vehicle" ? vehicleOpts : driverOpts

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-management">
      <View
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}
      >
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{t("admin.management.title")}</Text>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
            {t("admin.management.subtitle")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {error ? <ErrorState error={error} onAction={() => void refresh()} testID="management-error" /> : null}

      {loading ? (
        <Card variant="container" testID="management-loading">
          <Skeleton width="100%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="70%" height={16} />
        </Card>
      ) : managers.length === 0 ? (
        <EmptyState
          title={t("admin.management.empty")}
          description={t("admin.management.emptyDescription")}
          icon={<Icon name="group" size={32} color={theme.colors.outline} />}
          testID="management-empty"
        />
      ) : (
        managers.map((m) => {
          const a = assignedOf(m)
          const isBusy = busyId === m.user_id
          return (
            <Card variant="surface" key={m.user_id} style={{ marginBottom: theme.spacing[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
                <Icon name="badge" size={theme.sizing.iconLg} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text preset="bodyStrong">{m.full_name ?? m.email ?? m.user_id}</Text>
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {[m.email, m.status].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {m.roles?.length ? (
                  <StatusBadge label={(m.roles ?? [])[0] ?? ""} tone="info" />
                ) : null}
              </View>

              <View style={{ flexDirection: "row", gap: theme.spacing[4], marginTop: theme.spacing[3] }}>
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {t("admin.analytics.vehicles")}: {a.vehicleIds.length}
                </Text>
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {t("admin.analytics.drivers")}: {a.driverIds.length}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
                <Button
                  variant="secondary"
                  loading={isBusy}
                  fullWidth={false}
                  onPress={() => openPicker(m, "vehicle")}
                  testID={`assign-vehicles-${m.user_id}`}
                >
                  {t("admin.management.assignVehicles")}
                </Button>
                <Button
                  variant="secondary"
                  loading={isBusy}
                  fullWidth={false}
                  onPress={() => openPicker(m, "driver")}
                  testID={`assign-drivers-${m.user_id}`}
                >
                  {t("admin.management.assignDrivers")}
                </Button>
              </View>
            </Card>
          )
        })
      )}

      <MultiSelectSheet
        open={!!picker}
        onClose={commit}
        centered={theme.isTablet}
        title={
          picker?.kind === "vehicle"
            ? t("admin.management.pickVehicles")
            : t("admin.management.pickDrivers")
        }
        options={pickerOptions}
        selected={draft}
        onToggle={toggle}
        searchPlaceholder={t("common.search")}
        emptyText={t("admin.management.noOptions")}
        doneLabel={t("common.done")}
        testID="admin-assign-sheet"
      />
    </ScrollView>
  )
}
