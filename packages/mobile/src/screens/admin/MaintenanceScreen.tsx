// packages/mobile/src/screens/admin/MaintenanceScreen.tsx
//
// Maintenance management (spec `admin_maintenance_management`). Three fleet-health stat cards
// (due / overdue / in shop) over a Carbon DataTable of recorded work orders from `GET /maintenance`,
// plus a "New work order" bottom sheet that posts to `POST /maintenance/work-orders`.
//
// `app.maintenance_records` is a completion log, so the queue statuses are derived from how long
// ago the last service for a plate was recorded — see `MaintenanceService.counts`.

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { StatCard } from "@/design/components/StatCard"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { BottomSheet } from "@/design/components/BottomSheet"
import { DataTable, type DataTableColumn } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { MaintenanceRow } from "@/core/admin"

export interface MaintenanceScreenProps {
  services: Services
  onBack: () => void
  /** Opens the vehicle behind a work-order row, when the router wires it. */
  onSelectVehicle?: (vehicleId: string) => void
}

/** Age of a completion record, used for both the row chip and the header counters. */
function ageBucket(performedAt: string): { label: string; tone: BadgeTone } {
  const at = Date.parse(performedAt)
  const DAY = 24 * 60 * 60 * 1000
  if (!Number.isFinite(at)) return { label: t("admin.maintenance.statusUnknown"), tone: "neutral" }
  const ageDays = (Date.now() - at) / DAY
  if (ageDays < 0) return { label: t("admin.maintenance.statusInShop"), tone: "info" }
  if (ageDays > 180) return { label: t("admin.maintenance.statusOverdue"), tone: "danger" }
  if (ageDays > 150) return { label: t("admin.maintenance.statusDue"), tone: "warning" }
  return { label: t("admin.maintenance.statusServiced"), tone: "success" }
}

export function MaintenanceScreen({ services, onBack, onSelectVehicle }: MaintenanceScreenProps) {
  const [rows, setRows] = useState<MaintenanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()

  // Work-order form. `performed_at` defaults to now because the endpoint records completions.
  const [vehicleId, setVehicleId] = useState("")
  const [taskCode, setTaskCode] = useState("")
  const [odometer, setOdometer] = useState("")
  const [vendor, setVendor] = useState("")
  const [cost, setCost] = useState("")
  const [notes, setNotes] = useState("")

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      await services.admin.maintenance.load()
      setRows([...services.admin.maintenance.rows])
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
    const off = services.admin.maintenance.onChange(() => setRows([...services.admin.maintenance.rows]))
    return off
  }, [services, refresh])

  const counts = useMemo(() => services.admin.maintenance.counts, [services, rows])

  const resetForm = () => {
    setVehicleId("")
    setTaskCode("")
    setOdometer("")
    setVendor("")
    setCost("")
    setNotes("")
    setFormError(undefined)
  }

  const submit = async () => {
    setBusy(true)
    setFormError(undefined)
    try {
      await services.admin.maintenance.createWorkOrder({
        vehicle_id: vehicleId.trim(),
        task_code: taskCode.trim(),
        performed_at: new Date().toISOString(),
        ...(odometer.trim() ? { odometer_km: Number(odometer) } : {}),
        ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
        ...(cost.trim() ? { cost: Number(cost) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      setSheetOpen(false)
      resetForm()
      setRows([...services.admin.maintenance.rows])
    } catch (e) {
      setFormError(fromUnknown(e).message || (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = vehicleId.trim().length > 0 && taskCode.trim().length > 0 && !busy

  const columns: DataTableColumn<MaintenanceRow>[] = [
    {
      key: "vehicle",
      header: t("admin.maintenance.colVehicle"),
      flex: 1.5,
      render: (r) => (
        <Text preset="bodyStrong" color={theme.colors.interactive01}>
          {r.vehicle_plate ?? t("common.notAvailable")}
        </Text>
      ),
    },
    {
      key: "task",
      header: t("admin.maintenance.colTask"),
      flex: 2.5,
      render: (r) => <Text preset="body02">{r.task_name}</Text>,
    },
    {
      key: "performed",
      header: t("admin.maintenance.colPerformed"),
      flex: 1.5,
      render: (r) => (
        <Text preset="caption" color={theme.colors.textSecondary}>
          {r.performed_at.slice(0, 10)}
        </Text>
      ),
    },
    {
      key: "vendor",
      header: t("admin.maintenance.colVendor"),
      flex: 1.5,
      render: (r) => (
        <Text preset="caption" color={theme.colors.textSecondary}>
          {r.vendor ?? t("admin.maintenance.internal")}
        </Text>
      ),
    },
    {
      key: "cost",
      header: t("admin.maintenance.colCost"),
      flex: 1,
      align: "right",
      render: (r) => (
        <Text preset="body02">{r.cost != null ? r.cost.toFixed(2) : t("common.notAvailable")}</Text>
      ),
    },
    {
      key: "status",
      header: t("admin.maintenance.colStatus"),
      flex: 1.5,
      render: (r) => {
        const bucket = ageBucket(r.performed_at)
        return <StatusBadge label={bucket.label} tone={bucket.tone} />
      },
    },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui02 }} testID="admin-maintenance">
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: theme.spacing[4],
          }}
        >
          <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
            <Text preset="heading03">{t("admin.maintenance.title")}</Text>
            <Text preset="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[1] }}>
              {t("admin.maintenance.subtitle")}
            </Text>
          </View>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>

        {/* Fleet health overview */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2] }}>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard
              label={t("admin.maintenance.statDue")}
              value={String(counts.due)}
              tone="warning"
              testID="maintenance-stat-due"
            />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard
              label={t("admin.maintenance.statOverdue")}
              value={String(counts.overdue)}
              tone="danger"
              testID="maintenance-stat-overdue"
            />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard
              label={t("admin.maintenance.statInShop")}
              value={String(counts.inShop)}
              tone="info"
              testID="maintenance-stat-inshop"
            />
          </View>
          <View style={{ width: "50%", padding: theme.spacing[2] }}>
            <StatCard
              label={t("admin.maintenance.statRecords")}
              value={String(rows.length)}
              tone="neutral"
              testID="maintenance-stat-records"
            />
          </View>
        </View>

        {error ? (
          <View style={{ marginTop: theme.spacing[4] }}>
            <ErrorState error={error} onAction={() => void refresh()} />
          </View>
        ) : null}

        {/* Work-order log */}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Text preset="title" style={{ marginBottom: theme.spacing[3] }}>
            {t("admin.maintenance.workOrders")}
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
              title={t("admin.maintenance.empty")}
              description={t("admin.maintenance.emptyDescription")}
              actionLabel={t("admin.maintenance.newWorkOrder")}
              onAction={() => setSheetOpen(true)}
              icon={<Icon name="build" size={32} color={theme.colors.outline} />}
            />
          ) : (
            <Card variant="container" style={{ padding: 0 }}>
              <DataTable
                testID="maintenance-table"
                columns={columns}
                rows={rows}
                onRowPress={onSelectVehicle ? () => undefined : undefined}
              />
            </Card>
          )}
        </View>

        <View style={{ height: theme.sizing.bottomNavHeight }} />
      </ScrollView>

      {/* FAB-style create action */}
      <View style={{ position: "absolute", right: theme.spacing[5], bottom: theme.spacing[5] }}>
        <Button
          variant="primary"
          fullWidth={false}
          onPress={() => setSheetOpen(true)}
          testID="maintenance-new"
          label={t("admin.maintenance.newWorkOrder")}
          icon={<Icon name="add" size={theme.sizing.iconMd} color={theme.colors.textOnColor} />}
        />
      </View>

      <BottomSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false)
          resetForm()
        }}
        title={t("admin.maintenance.newWorkOrder")}
        centered={theme.isTablet}
      >
        <ScrollView>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[4] }}>
            {t("admin.maintenance.newWorkOrderHelp")}
          </Text>
          <Input
            label={t("admin.maintenance.vehicleId")}
            value={vehicleId}
            onChangeText={setVehicleId}
            required
            autoCapitalize="none"
            placeholder={t("admin.maintenance.vehicleIdPlaceholder")}
            testID="work-order-vehicle"
          />
          <Input
            label={t("admin.maintenance.taskCode")}
            value={taskCode}
            onChangeText={setTaskCode}
            required
            autoCapitalize="characters"
            placeholder={t("admin.maintenance.taskCodePlaceholder")}
            testID="work-order-task"
          />
          <Input
            label={t("admin.maintenance.odometer")}
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            testID="work-order-odometer"
          />
          <Input
            label={t("admin.maintenance.vendor")}
            value={vendor}
            onChangeText={setVendor}
            testID="work-order-vendor"
          />
          <Input
            label={t("admin.maintenance.cost")}
            value={cost}
            onChangeText={setCost}
            keyboardType="decimal-pad"
            testID="work-order-cost"
          />
          <Input
            label={t("admin.maintenance.notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            testID="work-order-notes"
          />
          {formError ? (
            <Text preset="caption" color={theme.colors.supportError} style={{ marginBottom: theme.spacing[3] }}>
              {formError}
            </Text>
          ) : null}
          <Button variant="primary" loading={busy} disabled={!canSubmit} onPress={submit} testID="work-order-submit">
            {t("admin.maintenance.recordWorkOrder")}
          </Button>
          <View style={{ marginTop: theme.spacing[3] }}>
            <Button
              variant="ghost"
              onPress={() => {
                setSheetOpen(false)
                resetForm()
              }}
            >
              {t("common.cancel")}
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  )
}
