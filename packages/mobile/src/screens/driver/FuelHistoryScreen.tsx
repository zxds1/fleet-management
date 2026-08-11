// packages/mobile/src/screens/driver/FuelHistoryScreen.tsx
//
// B.9 Fuel History. Cursor list of the driver's own purchases with their reconciliation status
// (verified / rejected / cleared with reason). Tapping a row opens the read-only purchase detail.
// Self-fetching: reads `services.refuel.listHistory()` on mount.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { PurchaseSummary as PurchaseRow } from "@/core/driver/refuel"

export interface PurchaseSummary {
  purchase_id: string
  purchased_at?: string
  vehicle_label?: string | null
  litres?: number | null
  total_cost?: number | null
  currency?: string | null
  supplier?: string | null
  odometer_km?: number | null
  /** PENDING | VERIFIED | REJECTED | CLEARED | FLAGGED */
  reconciliation_status?: string | null
  reason?: string | null
}

export interface FuelHistoryScreenProps {
  services: Services
  onSelect: (purchaseId: string) => void
  onBack: () => void
}

/** Map the service read model (`GET /fuel/refuel/me`) onto this screen's row shape. */
function toRow(p: PurchaseRow): PurchaseSummary {
  const amount = p.total_cost.amount
  return {
    purchase_id: p.purchase_id,
    purchased_at: p.purchased_at,
    vehicle_label: p.vehicle_plate,
    litres: p.litres,
    total_cost: amount === null ? null : Number(amount),
    currency: p.currency,
    supplier: p.supplier_name,
    odometer_km: p.odometer_km,
    reconciliation_status: p.reconciliation_status,
    reason: p.rejection_reason,
  }
}


function tone(status?: string | null): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "VERIFIED":
    case "CLEARED":
      return "success"
    case "REJECTED":
      return "danger"
    case "FLAGGED":
      return "warning"
    default:
      return "neutral"
  }
}

function formatWhen(iso?: string): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleString()
}

export function FuelHistoryScreen({ services, onSelect, onBack }: FuelHistoryScreenProps) {
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPurchases((await services.refuel.listHistory()).map(toRow))
    } catch {
      // Offline / unavailable → the empty state covers it.
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="fuel-history-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="fuel-history-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Icon name="local_gas_station" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.fuelHistory.title")}</Text>
      </View>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.fuelHistory.subtitle")}
      </Text>

      {purchases.length === 0 ? (
        <EmptyState
          icon={<Icon name="local_gas_station" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.fuelHistory.empty")}
          description={loading ? undefined : t("driver.fuelHistory.emptyDescription")}
          testID="fuel-history-empty"
        />
      ) : (
        purchases.map((p) => (
          <Card key={p.purchase_id} variant="container" style={{ padding: 0 }} testID={`purchase-${p.purchase_id}`}>
            <ListRow
              title={formatWhen(p.purchased_at)}
              subtitle={p.vehicle_label ?? p.supplier ?? t("common.notAvailable")}
              onPress={() => onSelect(p.purchase_id)}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                  <StatusBadge
                    label={t(`driver.fuelHistory.status.${p.reconciliation_status ?? "PENDING"}`)}
                    tone={tone(p.reconciliation_status)}
                  />
                  <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />
                </View>
              }
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing[4],
                paddingHorizontal: theme.spacing[5],
                paddingVertical: theme.spacing[3],
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                <Icon name="gas_meter" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {p.litres !== null && p.litres !== undefined ? `${p.litres} ${t("common.litres")}` : t("common.notAvailable")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                <Icon name="receipt_long" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {p.total_cost !== null && p.total_cost !== undefined
                    ? `${p.currency ?? ""} ${p.total_cost}`.trim()
                    : t("common.notAvailable")}
                </Text>
              </View>
            </View>
            {p.reason ? (
              <View style={{ paddingHorizontal: theme.spacing[5], paddingBottom: theme.spacing[3] }}>
                <Text preset="caption" color={theme.colors.error}>
                  {p.reason}
                </Text>
              </View>
            ) : null}
          </Card>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button
          variant="secondary"
          onPress={() => void load()}
          loading={loading}
          label={t("common.pullToRefresh")}
          testID="fuel-history-refresh"
        />
      </View>
    </ScrollView>
  )
}
