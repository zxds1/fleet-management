// packages/mobile/src/screens/driver/MyShiftsScreen.tsx
//
// B.7 My Shifts (history). Cursor-paged, read-only list of the driver's completed shifts
// (date, vehicle, duration, status, verification status). Tapping a row opens the read-only
// shift detail. Self-fetching: reads `services.shifts.listHistory()` on mount.

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
import type { ShiftSummary as ShiftHistoryRow } from "@/core/driver/shifts"

export interface ShiftSummary {
  shift_id: string
  /** ISO timestamp of clock-in; rendered as the row's primary date. */
  started_at?: string
  ended_at?: string | null
  vehicle_label?: string | null
  /** Human duration already computed by the caller, or minutes to be formatted here. */
  duration_minutes?: number | null
  distance_km?: number | null
  status?: string | null
  verification_status?: string | null
}

export interface MyShiftsScreenProps {
  services: Services
  onSelect: (shiftId: string) => void
  onBack: () => void
}

/** Map the service read model (`GET /shifts/me`) onto the row shape this screen renders. */
function toRow(s: ShiftHistoryRow): ShiftSummary {
  return {
    shift_id: s.shift_id,
    started_at: s.clock_in_at ?? undefined,
    ended_at: s.clock_out_at ?? null,
    vehicle_label: s.vehicle_plate ?? s.vehicle_id ?? null,
    duration_minutes: s.duration_seconds !== null && s.duration_seconds !== undefined ? s.duration_seconds / 60 : null,
    distance_km: s.distance_km ?? null,
    status: s.state ?? null,
    verification_status: s.verification_status ?? null,
  }
}


function formatDate(iso?: string): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleDateString()
}

function formatDuration(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return t("common.notAvailable")
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m}m`
}

function verificationTone(status?: string | null): "neutral" | "success" | "warning" | "danger" {
  switch (status) {
    case "VERIFIED":
      return "success"
    case "REJECTED":
      return "danger"
    case "FLAGGED":
      return "warning"
    default:
      return "neutral"
  }
}

export function MyShiftsScreen({ services, onSelect, onBack }: MyShiftsScreenProps) {
  const [shifts, setShifts] = useState<ShiftSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await services.shifts.listHistory()
      setShifts(page.items.map(toRow))
    } catch {
      // Offline / unavailable → keep the last page and let the empty state speak.
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="my-shifts-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="my-shifts-back"
        />
      </View>

      <Text preset="heading03">{t("driver.shifts.title")}</Text>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.shifts.subtitle")}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
        <Icon name="history" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {t("driver.shifts.past")}
        </Text>
      </View>

      {shifts.length === 0 ? (
        <EmptyState
          icon={<Icon name="schedule" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.shifts.empty")}
          description={loading ? undefined : t("driver.shifts.emptyDescription")}
          testID="my-shifts-empty"
        />
      ) : (
        shifts.map((s) => (
          <Card key={s.shift_id} variant="container" style={{ padding: 0 }} testID={`shift-${s.shift_id}`}>
            <ListRow
              title={formatDate(s.started_at)}
              subtitle={`${s.vehicle_label ?? t("common.notAvailable")} · ${formatDuration(s.duration_minutes)}`}
              onPress={() => onSelect(s.shift_id)}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                  <StatusBadge
                    label={t(`driver.shifts.verificationStatus.${s.verification_status ?? "PENDING"}`)}
                    tone={verificationTone(s.verification_status)}
                  />
                  <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />
                </View>
              }
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing[2],
                paddingHorizontal: theme.spacing[5],
                paddingVertical: theme.spacing[3],
              }}
            >
              <Icon name="local_shipping" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t(`driver.shifts.status.${s.status || "CLOSED"}`)}
              </Text>
              {s.distance_km !== null && s.distance_km !== undefined ? (
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {`· ${s.distance_km} ${t("common.km")}`}
                </Text>
              ) : null}
            </View>
          </Card>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button variant="secondary" onPress={() => void load()} loading={loading} label={t("common.pullToRefresh")} testID="my-shifts-refresh" />
      </View>
    </ScrollView>
  )
}
