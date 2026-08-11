// packages/mobile/src/screens/admin/VehiclesScreen.tsx
//
// Vehicles console: list the company's vehicles (cars), create a new one, and assign DRIVERS and
// linked CARS to a vehicle via multi-select dropdowns ("admin assigns cars and drivers to cars").
//
// Binds to `GET /vehicles` + `POST /vehicles` (existing contract) and the new
// `POST /vehicles/{id}/assign` (contract in packages/mobile/BACKEND_TODO.md). The assignment picker
// is populated from the company vehicle + driver pools.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { Input } from "@/design/components/Input"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { StatusBadge } from "@/design/components/StatusBadge"
import { MultiSelectSheet, type MultiSelectOption } from "@/design/components/MultiSelectSheet"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { VehicleRecord } from "@/core/admin"

export interface VehiclesScreenProps {
  services: Services
  onBack: () => void
  /** Opens `VehicleDetailScreen` for the selected vehicle. */
  onSelect?: (vehicleId: string) => void
}

function statusTone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "AVAILABLE":
      return "success"
    case "IN_USE":
      return "info"
    case "MAINTENANCE":
      return "warning"
    case "QUARANTINED":
    case "RETIRED":
      return "danger"
    default:
      return "neutral"
  }
}

export function VehiclesScreen({ services, onBack, onSelect }: VehiclesScreenProps) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [busyId, setBusyId] = useState<string>()

  const [creating, setCreating] = useState(false)
  const [newPlate, setNewPlate] = useState("")
  const [newMake, setNewMake] = useState("")
  const [newModel, setNewModel] = useState("")
  const [newYear, setNewYear] = useState("")
  const [newClass, setNewClass] = useState("")

  const [driverOpts, setDriverOpts] = useState<MultiSelectOption[]>([])
  const [vehicleOpts, setVehicleOpts] = useState<MultiSelectOption[]>([])

  const [picker, setPicker] = useState<{ vehicleId: string; kind: "driver" | "vehicle" } | null>(null)
  const [draft, setDraft] = useState<string[]>([])

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const [v, d] = await Promise.all([
        services.admin.vehicles.load(200).then(() => services.admin.vehicles.vehicles),
        services.admin.drivers.load().then(() => services.admin.drivers.drivers),
      ])
      setVehicles(v)
      setDriverOpts(d.map((x) => ({ value: x.user_id, label: x.full_name ?? x.phone ?? x.email ?? x.user_id })))
      // Linked-cars pool excludes the vehicle being edited (set per-picker below).
      setVehicleOpts(v.map((x) => ({ value: x.id, label: x.license_plate })))
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const doCreate = async () => {
    setError(undefined)
    try {
      await services.admin.vehicles.createVehicle({
        license_plate: newPlate.trim(),
        make: newMake.trim() || undefined,
        model: newModel.trim() || undefined,
        year: newYear.trim() ? Number(newYear.trim()) : undefined,
        vehicle_class: newClass.trim() || undefined,
      })
      setCreating(false)
      setNewPlate("")
      setNewMake("")
      setNewModel("")
      setNewYear("")
      setNewClass("")
      await refresh()
    } catch (e) {
      setError(fromUnknown(e))
    }
  }

  const openPicker = (vehicle: VehicleRecord, kind: "driver" | "vehicle") => {
    // The linked-cars pool excludes this vehicle itself (handled live in the picker below).
    setPicker({ vehicleId: vehicle.id, kind })
    // Seed the draft from the cached detail is not available here; start from the picker's live state.
    setDraft([])
  }

  const toggle = (value: string) =>
    setDraft((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))

  const commit = async () => {
    if (!picker) return
    setBusyId(picker.vehicleId)
    try {
      await services.admin.assignments.assignVehicle(picker.vehicleId, {
        driver_ids: picker.kind === "driver" ? draft : [],
        vehicle_ids: picker.kind === "vehicle" ? draft : [],
      })
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setBusyId(undefined)
      setPicker(null)
    }
  }

  const pickerOptions = picker?.kind === "vehicle" ? vehicleOpts.filter((o) => o.value !== picker.vehicleId) : driverOpts

  if (creating) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-vehicle-create">
        <Text preset="heading03">{t("admin.vehicles.createTitle")}</Text>
        <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1], marginBottom: theme.spacing[3] }}>
          {t("admin.vehicles.createBody")}
        </Text>
        <Input label={t("admin.vehicles.plate")} value={newPlate} onChangeText={setNewPlate} autoCapitalize="characters" testID="vehicle-plate" />
        <Input label={t("admin.vehicles.make")} value={newMake} onChangeText={setNewMake} testID="vehicle-make" />
        <Input label={t("admin.vehicles.model")} value={newModel} onChangeText={setNewModel} testID="vehicle-model" />
        <Input label={t("admin.vehicles.year")} value={newYear} onChangeText={setNewYear} keyboardType="numeric" testID="vehicle-year" />
        <Input label={t("admin.vehicles.vehicleClass")} value={newClass} onChangeText={setNewClass} testID="vehicle-class" />
        {error ? (
          <Text preset="caption" color={theme.colors.supportError} style={{ marginTop: theme.spacing[2] }}>
            {error.message}
          </Text>
        ) : null}
        <Button variant="primary" loading={loading} disabled={!newPlate.trim()} onPress={doCreate} testID="vehicle-create-submit">
          {t("admin.vehicles.create")}
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setCreating(false)
            setNewPlate("")
            setNewMake("")
            setNewModel("")
            setNewYear("")
            setNewClass("")
          }}
        >
          {t("common.cancel")}
        </Button>
      </ScrollView>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui02 }} testID="admin-vehicles">
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
            <Text preset="heading03">{t("admin.vehicles.title")}</Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
              {t("admin.vehicles.subtitle")}
            </Text>
          </View>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>

        {error ? <ErrorState error={error} onAction={() => void refresh()} testID="vehicles-error" /> : null}

        {loading ? (
          <Card variant="container" testID="vehicles-loading">
            <Skeleton width="100%" height={20} />
            <View style={{ height: theme.spacing[3] }} />
            <Skeleton width="70%" height={16} />
          </Card>
        ) : vehicles.length === 0 ? (
          <EmptyState
            title={t("admin.vehicles.empty")}
            description={t("admin.vehicles.emptyDescription")}
            icon={<Icon name="local_shipping" size={32} color={theme.colors.outline} />}
            testID="vehicles-empty"
          />
        ) : (
          vehicles.map((v) => {
            const isBusy = busyId === v.id
            return (
              <Card variant="surface" key={v.id} style={{ marginBottom: theme.spacing[3] }} onPress={() => onSelect?.(v.id)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
                  <Icon name="local_shipping" size={theme.sizing.iconLg} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text preset="bodyStrong">{v.license_plate}</Text>
                    <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                      {[v.year, v.make, v.model].filter(Boolean).join(" ") || t("common.notAvailable")}
                    </Text>
                  </View>
                  {v.status ? <StatusBadge label={v.status} tone={statusTone(v.status)} /> : null}
                </View>
                <View style={{ flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[3] }}>
                  <Button
                    variant="secondary"
                    loading={isBusy}
                    fullWidth={false}
                    onPress={() => openPicker(v, "driver")}
                    testID={`assign-drivers-${v.id}`}
                  >
                    {t("admin.vehicles.assignDrivers")}
                  </Button>
                  <Button
                    variant="secondary"
                    loading={isBusy}
                    fullWidth={false}
                    onPress={() => openPicker(v, "vehicle")}
                    testID={`assign-cars-${v.id}`}
                  >
                    {t("admin.vehicles.assignCars")}
                  </Button>
                </View>
              </Card>
            )
          })
        )}
      </ScrollView>

      {/* FAB-style create */}
      <View style={{ position: "absolute", right: theme.spacing[5], bottom: theme.spacing[5] }}>
        <Button
          variant="primary"
          fullWidth={false}
          onPress={() => setCreating(true)}
          testID="create-vehicle"
          label={t("admin.vehicles.create")}
          icon={<Icon name="add" size={theme.sizing.iconMd} color={theme.colors.textOnColor} />}
        />
      </View>

      <MultiSelectSheet
        open={!!picker}
        onClose={commit}
        centered={theme.isTablet}
        title={picker?.kind === "driver" ? t("admin.vehicles.pickDrivers") : t("admin.vehicles.pickCars")}
        options={pickerOptions}
        selected={draft}
        onToggle={toggle}
        searchPlaceholder={t("common.search")}
        emptyText={t("admin.vehicles.noOptions")}
        doneLabel={t("common.done")}
        testID="vehicle-assign-sheet"
      />
    </View>
  )
}
