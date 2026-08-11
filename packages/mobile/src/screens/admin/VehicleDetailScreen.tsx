// packages/mobile/src/screens/admin/VehicleDetailScreen.tsx
//
// Vehicle detail drawer (spec `vehicle_detail_refined`). Reached by tapping a marker on the Live
// Map, so it accepts either a live `VehicleState` (what the map already holds) or just an id, in
// which case it fetches the master-data record from `GET /vehicles/{id}`.
//
// The two sources are complementary and both are rendered: the master record supplies plate, class,
// make/model, odometer and quarantine reason; the live state supplies display state, position and
// the assigned driver. Neither is required — the screen degrades to whichever half resolved.
//
// Visual reference: header with plate + status chip and make/model subtitle, a last-known-location
// card accented by severity, a bento grid of assignment / odometer, a linked-documents list and a
// quarantine banner.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge, DisplayStateBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { DataTable } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { DisplayState, VehicleRecord, VehicleState, DocumentRow } from "@/core/admin"

export interface VehicleDetailScreenProps {
  services: Services
  /** Vehicle selected on the Live Map. */
  id?: string
  onBack: () => void
  /**
   * Live state for the vehicle, when the caller already has it (the map does). Saves a round trip
   * and keeps the position/driver panel populated even if the master-data read fails.
   */
  vehicle?: VehicleState
  /** Opens the linked document in `DocumentDetailScreen`. */
  onSelectDocument?: (documentId: string) => void
}

/** A vehicle is quarantined either by its master-data status or by the live display state. */
function isQuarantined(record: VehicleRecord | null, state: VehicleState | undefined): boolean {
  return record?.status === "QUARANTINED" || state?.display_state === "QUARANTINED"
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

export function VehicleDetailScreen({
  services,
  id,
  onBack,
  vehicle: vehicleProp,
  onSelectDocument,
}: VehicleDetailScreenProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [record, setRecord] = useState<VehicleRecord | null>(null)
  const [documents, setDocuments] = useState<DocumentRow[]>([])

  // The live state is whatever the caller handed us, else the matching row in the map snapshot.
  const liveState =
    vehicleProp ?? services.admin.dashboard.vehicles.find((v) => v.vehicle_id === id)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    setError(undefined)
    try {
      const found = await services.admin.vehicles.getOne(id)
      setRecord(found ?? null)
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services, id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Documents are filtered client-side from the expiring feed: the registry keys them by subject
  // id, and the expiring list is the only document surface in the locked contract.
  useEffect(() => {
    let active = true
    void services.admin.documents
      .load()
      .then(() => {
        if (!active) return
        setDocuments(services.admin.documents.documents.filter((d) => d.subject_id === id))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [services, id])

  const plate = record?.license_plate ?? liveState?.vehicle_id?.slice(0, 8) ?? t("common.notAvailable")
  const quarantined = isQuarantined(record, liveState)

  const header = (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: theme.spacing[4],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
        <Icon name="local_shipping" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03" numberOfLines={1}>
          {t("admin.vehicle.title")}
        </Text>
      </View>
      <Button variant="ghost" fullWidth={false} onPress={onBack}>
        {t("common.back")}
      </Button>
    </View>
  )

  if (loading) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-vehicle-detail">
        {header}
        <Card variant="container">
          <Skeleton width="60%" height={24} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="40%" height={16} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={16} />
        </Card>
      </ScrollView>
    )
  }

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-vehicle-detail">
        {header}
        <ErrorState error={error} onAction={() => void refresh()} />
      </ScrollView>
    )
  }

  if (!record && !liveState) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-vehicle-detail">
        {header}
        <EmptyState
          title={t("admin.vehicle.notFound")}
          description={t("admin.vehicle.notFoundDescription")}
          icon={<Icon name="local_shipping" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-vehicle-detail">
      {header}

      {/* Identity + status */}
      <Card
        variant="container"
        accent={quarantined ? theme.colors.supportError : theme.colors.primary}
        testID="vehicle-identity"
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="local_shipping" size={theme.sizing.iconLg} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text preset="heading02">{plate}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[1] }}>
              <Icon name="directions_car" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {[record?.year, record?.make, record?.model].filter(Boolean).join(" ") || t("common.notAvailable")}
              </Text>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          {record?.status ? <StatusBadge label={record.status} tone={statusTone(record.status)} /> : null}
          {liveState ? (
            <DisplayStateBadge
              states={[liveState.display_state as DisplayState]}
              labelFor={(s) => t(`displayState.${s}`)}
            />
          ) : null}
          {record?.is_operational === false ? (
            <StatusBadge label={t("admin.vehicle.nonOperational")} tone="danger" />
          ) : null}
        </View>
      </Card>

      {/* Quarantine banner — the single most consequential fact about a vehicle (N5). */}
      {quarantined ? (
        <Card variant="container" accent={theme.colors.supportError} testID="vehicle-quarantine">
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
            <Icon name="gpp_good" size={theme.sizing.iconLg} color={theme.colors.error} />
            <View style={{ flex: 1 }}>
              <Text preset="bodyStrong" color={theme.colors.error}>
                {t("admin.vehicle.quarantined")}
              </Text>
              <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                {record?.non_operational_reason ?? t("admin.vehicle.quarantineHelp")}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Last known location */}
      <Card variant="container" title={t("admin.vehicle.lastKnownLocation")}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon
            name="location_on"
            size={theme.sizing.iconLg}
            color={quarantined ? theme.colors.error : theme.colors.primary}
          />
          <View style={{ flex: 1 }}>
            <Text preset="body02">
              {liveState?.latitude != null && liveState?.longitude != null
                ? `${liveState.latitude.toFixed(4)}, ${liveState.longitude.toFixed(4)}`
                : t("driver.vehicle.noPosition")}
            </Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
              {liveState?.driver_name
                ? t("admin.vehicle.assignedTo", { driver: liveState.driver_name })
                : t("admin.vehicle.unassigned")}
            </Text>
          </View>
        </View>
      </Card>

      {/* Master data */}
      <Card variant="container" title={t("admin.vehicle.masterData")} style={{ padding: 0 }}>
        <DataTable<{ label: string; value: string }>
          testID="vehicle-master-table"
          columns={[
            {
              key: "label",
              header: t("admin.vehicle.field"),
              flex: 1,
              render: (r) => (
                <Text preset="label" color={theme.colors.onSurfaceVariant}>
                  {r.label}
                </Text>
              ),
            },
            {
              key: "value",
              header: t("admin.vehicle.value"),
              flex: 1,
              align: "right",
              render: (r) => <Text preset="body02">{r.value}</Text>,
            },
          ]}
          rows={[
            { label: t("admin.vehicle.plate"), value: record?.license_plate ?? t("common.notAvailable") },
            { label: t("admin.vehicle.makeModel"), value: [record?.make, record?.model].filter(Boolean).join(" ") || t("common.notAvailable") },
            {
              label: t("admin.vehicle.odometer"),
              value:
                record?.current_odometer_km != null
                  ? t("admin.vehicle.km", { value: Math.round(record.current_odometer_km) })
                  : t("common.notAvailable"),
            },
            {
              label: t("admin.vehicle.nextService"),
              value:
                record?.current_odometer_km != null
                  ? t("admin.vehicle.km", { value: nextServiceKm(record.current_odometer_km) })
                  : t("common.notAvailable"),
            },
            { label: t("admin.vehicle.ownership"), value: record?.ownership_type ?? t("common.notAvailable") },
          ]}
        />
      </Card>

      {/* Linked documents */}
      <Card variant="container" title={t("admin.vehicle.linkedDocuments")}>
        {documents.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.vehicle.noDocuments")}
          </Text>
        ) : (
          documents.map((d) => {
            const days = d.days_remaining
            const expired = days != null && days <= 0
            return (
              <Card
                key={d.document_id ?? `${d.document_type}-${d.expires_on}`}
                variant="surface"
                style={{ marginBottom: theme.spacing[2] }}
                testID={`vehicle-document-${d.document_id}`}
                onPress={d.document_id && onSelectDocument ? () => onSelectDocument(d.document_id!) : undefined}
                accessibilityLabel={d.document_type ?? t("admin.vehicle.linkedDocuments")}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
                  <Icon name="description" size={theme.sizing.iconLg} color={theme.colors.onSurfaceVariant} />
                  <View style={{ flex: 1 }}>
                    <Text preset="body02">{d.document_type ?? t("common.notAvailable")}</Text>
                    <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                      {d.expires_on ?? t("common.notAvailable")}
                    </Text>
                  </View>
                  <StatusBadge
                    label={
                      expired
                        ? t("driver.documents.expired")
                        : t("driver.documents.expiresIn", { days: days ?? 0 })
                    }
                    tone={expired ? "danger" : days != null && days <= 30 ? "warning" : "success"}
                  />
                </View>
              </Card>
            )
          })
        )}
      </Card>
    </ScrollView>
  )
}

/**
 * Next scheduled service odometer. The vehicle registry has no `next_service_km` column, so the
 * standard 15 000 km PM interval is projected from the current reading. Kept as a named helper so
 * the derivation is explicit rather than an inline magic number.
 */
const SERVICE_INTERVAL_KM = 15_000

function nextServiceKm(currentKm: number): number {
  return (Math.floor(currentKm / SERVICE_INTERVAL_KM) + 1) * SERVICE_INTERVAL_KM
}
