// packages/mobile/src/screens/admin/LiveMapScreen.tsx
import React, { useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { MapView, type MapMarker } from "@/design/components/MapView"
import { StatusBadge, DisplayStateBadge } from "@/design/components/StatusBadge"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DisplayState, VehicleState } from "@/core/admin"

export interface LiveMapScreenProps {
  services: Services
  offline: boolean
  onBack: () => void
  /** Opens the vehicle detail drawer when a marker or list card is tapped. */
  onSelectVehicle?: (vehicleId: string) => void
}

export function LiveMapScreen({ services, offline, onBack, onSelectVehicle }: LiveMapScreenProps) {
  // `dashboard.vehicles` is mutated by the `map:vehicle-states` socket feed, so the screen must
  // subscribe: reading the field during render alone never re-renders on a push.
  const [vehicles, setVehicles] = useState<VehicleState[]>(services.admin.dashboard.vehicles)

  useEffect(() => {
    setVehicles([...services.admin.dashboard.vehicles])
    const off = services.admin.dashboard.onChange(() => setVehicles([...services.admin.dashboard.vehicles]))
    return off
  }, [services])

  const markers: MapMarker[] = vehicles
    .filter((v) => v.latitude != null && v.longitude != null)
    .map((v) => ({
      id: v.vehicle_id,
      latitude: v.latitude ?? 0,
      longitude: v.longitude ?? 0,
      state: v.display_state as DisplayState,
      label: v.vehicle_id.slice(0, 8),
      onPress: onSelectVehicle ? () => onSelectVehicle(v.vehicle_id) : undefined,
    }))

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.ui01 }} testID="admin-map">
      <View style={{ padding: theme.spacing[5], borderBottomWidth: 1, borderBottomColor: theme.colors.ui03 }}>
        <Text preset="heading03">{t("admin.map.title")}</Text>
        <Button variant="ghost" onPress={onBack}>{t("common.back")}</Button>
      </View>
      <View style={{ flex: 1, minHeight: 240 }}>
        <MapView markers={markers} online={!offline} variant="admin" />
      </View>
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ padding: theme.spacing[4] }}>
        {vehicles.length === 0 ? (
          <EmptyState title={t("admin.map.empty")} />
        ) : (
          vehicles.map((v) => (
            <Card key={v.vehicle_id} style={{ marginBottom: theme.spacing[3] }} onPress={onSelectVehicle ? () => onSelectVehicle(v.vehicle_id) : undefined}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text preset="body02">{v.vehicle_id.slice(0, 8)}</Text>
                <DisplayStateBadge states={[v.display_state as DisplayState]} labelFor={(s) => t(`displayState.${s}`)} />
              </View>
              {v.driver_name ? (
                <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: 2 }}>
                  {t("admin.map.assignment")}: {v.driver_name}
                </Text>
              ) : null}
              {v.latitude != null && v.longitude != null ? (
                <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary }}>
                  {t("admin.map.lastPosition")}: {v.latitude.toFixed(4)}, {v.longitude.toFixed(4)}
                </Text>
              ) : (
                <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary }}>{t("driver.vehicle.noPosition")}</Text>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  )
}
