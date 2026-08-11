// packages/mobile/src/screens/driver/DvirDetailScreen.tsx
//
// B.12 DVIR Detail. Read-only for the driver: per-item pass/fail with notes and photos, the review
// state set by the reviewer, and the BLOCKER quarantine flag. Self-fetching via
// `services.inspections.getOne(id)`.

import React, { useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DvirDetail as DvirDetailModel } from "@/core/driver/inspections"

export interface DvirItem {
  item_id: string
  label: string
  /** PASS | FAIL | NA */
  result?: string | null
  notes?: string | null
  photo_count?: number | null
  blocker?: boolean
}

export interface DvirDetail {
  inspection_id: string
  template_label?: string | null
  vehicle_label?: string | null
  trailer_label?: string | null
  submitted_at?: string
  /** DRAFT | SUBMITTED | REVIEWED | FLAGGED */
  status?: string | null
  review_note?: string | null
  quarantined?: boolean
  odometer_km?: number | null
  signature_name?: string | null
  items?: DvirItem[]
}

export interface DvirDetailScreenProps {
  services: Services
  id: string
  onBack: () => void
}

/** Map the service read model (`GET /inspections/{id}`) onto this screen's view model. */
function toDetail(d: DvirDetailModel): DvirDetail {
  return {
    inspection_id: d.inspection_id,
    template_label: d.template_label,
    vehicle_label: d.vehicle_label,
    trailer_label: d.trailer_label,
    submitted_at: d.submitted_at ?? undefined,
    status: d.status,
    review_note: d.review_note,
    quarantined: d.quarantined ?? false,
    odometer_km: d.odometer_km,
    signature_name: d.signature_name,
    items: (d.items ?? []).map((i) => ({
      item_id: i.item_id,
      label: i.label,
      result: i.result,
      notes: i.notes,
      photo_count: i.photo_count,
      blocker: i.blocker,
    })),
  }
}


function statusTone(status?: string | null): "neutral" | "info" | "success" | "danger" {
  switch (status) {
    case "REVIEWED":
      return "success"
    case "FLAGGED":
      return "danger"
    case "SUBMITTED":
      return "info"
    default:
      return "neutral"
  }
}

function formatWhen(iso?: string): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleString()
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: theme.spacing[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outlineVariant,
      }}
    >
      <Text preset="caption" color={theme.colors.onSurfaceVariant}>
        {label}
      </Text>
      <Text preset="bodyStrong">{value}</Text>
    </View>
  )
}

export function DvirDetailScreen({ services, id, onBack }: DvirDetailScreenProps) {
  const [dvir, setDvir] = useState<DvirDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    services.inspections
      .getOne(id)
      .then((d) => active && setDvir(toDetail(d)))
      .catch(() => active && setDvir(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [services, id])

  if (!dvir) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="dvir-detail-screen">
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
          <Button
            variant="ghost"
            fullWidth={false}
            onPress={onBack}
            icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            label={t("common.back")}
            testID="dvir-detail-back"
          />
        </View>
        <EmptyState
          icon={<Icon name="fact_check" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.dvir.empty")}
          testID="dvir-detail-empty"
        />
      </ScrollView>
    )
  }

  const items = dvir.items ?? []
  const failed = items.filter((i) => i.result === "FAIL")

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="dvir-detail-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="dvir-detail-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{dvir.vehicle_label ?? t("driver.dvir.detailTitle")}</Text>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.dvir.submittedAt", { when: formatWhen(dvir.submitted_at) })}
          </Text>
        </View>
        <StatusBadge label={t(`driver.dvir.status.${dvir.status ?? "SUBMITTED"}`)} tone={statusTone(dvir.status)} />
      </View>

      {dvir.quarantined ? (
        <Card variant="container" accent={theme.colors.supportError} style={{ marginTop: theme.spacing[4] }} testID="dvir-quarantine">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <Icon name="warning" size={theme.sizing.iconLg} color={theme.colors.error} filled />
            <Text preset="bodyStrong" color={theme.colors.onErrorContainer} style={{ flex: 1 }}>
              {t("driver.dvir.blockShift")}
            </Text>
          </View>
        </Card>
      ) : null}

      <Card variant="container" style={{ marginTop: theme.spacing[4] }} title={t("driver.dvir.detailTitle")}>
        <DetailRow label={t("driver.dvir.template")} value={dvir.template_label ?? t("common.notAvailable")} />
        <DetailRow label={t("driver.dvir.subject")} value={dvir.trailer_label ?? dvir.vehicle_label ?? t("common.notAvailable")} />
        <DetailRow
          label={t("driver.refuel.odometer")}
          value={dvir.odometer_km !== null && dvir.odometer_km !== undefined ? `${dvir.odometer_km} ${t("common.km")}` : t("common.notAvailable")}
        />
        <DetailRow label={t("driver.dvir.signature")} value={dvir.signature_name ?? t("common.notAvailable")} />
      </Card>

      {dvir.review_note ? (
        <Card variant="container" title={t("driver.dvir.reviewState")}>
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {dvir.review_note}
          </Text>
        </Card>
      ) : null}

      {failed.length > 0 ? (
        <Card
          variant="container"
          accent={theme.colors.supportError}
          title={t("driver.dvir.defectsFound")}
          trailing={<StatusBadge label={String(failed.length)} tone="danger" />}
          testID="dvir-defects"
        >
          {failed.map((item) => (
            <View key={item.item_id} style={{ marginTop: theme.spacing[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                <Icon name="error" size={theme.sizing.iconSm} color={theme.colors.error} />
                <Text preset="bodyStrong">{item.label}</Text>
              </View>
              {item.notes ? (
                <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
                  {item.notes}
                </Text>
              ) : null}
              {item.photo_count ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[2] }}>
                  <Icon name="camera" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {t("driver.dvir.photoCount", { count: item.photo_count })}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      <View style={{ marginTop: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
          <Icon name="list" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.dvir.items")}
          </Text>
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {t("driver.dvir.itemsChecked", { count: items.length })}
          </Text>
        </View>

        {items.length === 0 ? (
          <EmptyState
            icon={<Icon name="fact_check" size={32} color={theme.colors.onSurfaceVariant} />}
            title={t("driver.dvir.empty")}
            testID="dvir-detail-empty"
          />
        ) : (
          <Card variant="container" style={{ padding: 0 }}>
            {items.map((item) => {
              const failedItem = item.result === "FAIL"
              return (
                <View
                  key={item.item_id}
                  style={{
                    minHeight: theme.sizing.minTouchTarget,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: theme.spacing[3],
                    paddingHorizontal: theme.spacing[5],
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.ui03,
                  }}
                  testID={`dvir-item-${item.item_id}`}
                >
                  <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
                    <Text preset="body02">{item.label}</Text>
                    {item.notes ? (
                      <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                        {item.notes}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                    {item.photo_count ? (
                      <Icon name="camera" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
                    ) : null}
                    <Text preset="caption" color={failedItem ? theme.colors.error : theme.colors.onSurfaceVariant}>
                      {t(`driver.dvir.result.${item.result ?? "NA"}`)}
                    </Text>
                    <Icon
                      name={failedItem ? "error" : "check_circle"}
                      size={theme.sizing.iconMd}
                      color={failedItem ? theme.colors.error : theme.colors.success}
                    />
                  </View>
                </View>
              )
            })}
          </Card>
        )}
      </View>
    </ScrollView>
  )
}
