// packages/mobile/src/screens/admin/AnomalyDetailScreen.tsx
//
// C.14 Anomaly Detail. Read-only: description, evidence, recommended action and the linked entity.
// Resolution deliberately happens in the owning domain screen (fuel / DVIR / accident), so this
// screen exposes navigation-free content plus Back only.
//
// Visual reference: `admin_anomaly_detail` (severity chip in the header, bento telemetry/evidence
// cards, entity rows with chevrons, sensor timeline table).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { DataTable } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { AnomalyDetail as AnomalyDetailDto } from "@/core/admin"

/** Minimal shape of `GET /anomalies/{id}`. */
export interface AnomalyEvidenceRow {
  label?: string | null
  value?: string | null
  /** Highlights the row when the reading is out of tolerance. */
  out_of_range?: boolean | null
}

export interface AnomalyDetail {
  anomaly_id?: string | null
  code?: string | null
  title?: string | null
  description?: string | null
  domain?: string | null
  /** `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` */
  severity?: string | null
  detected_at?: string | null
  /** `OPEN` | `RESOLVED` | `DISMISSED` */
  status?: string | null
  recommended_action?: string | null
  linked_entity_type?: string | null
  linked_entity_id?: string | null
  linked_entity_label?: string | null
  driver_name?: string | null
  vehicle_plate?: string | null
  location_text?: string | null
  latitude?: number | null
  longitude?: number | null
  evidence?: AnomalyEvidenceRow[] | null
}

export interface AnomalyDetailScreenProps {
  services: Services
  /** Anomaly selected in `AnomalyFeedScreen`. */
  id?: string
  onBack: () => void
  /** Optional override — the screen fetches its own data when omitted. */
  anomaly?: AnomalyDetail
}

const severityTone = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
} as const

function toneFor(severity?: string | null): "neutral" | "info" | "warning" | "danger" {
  if (severity && severity in severityTone) return severityTone[severity as keyof typeof severityTone]
  return "neutral"
}

function accentFor(severity?: string | null): string {
  if (severity === "CRITICAL" || severity === "HIGH") return theme.colors.supportError
  if (severity === "MEDIUM") return theme.colors.supportWarning
  return theme.colors.outlineVariant
}

/** Maps the `AnomalyDetail` DTO from `services.admin.anomalies.getOne` onto this screen's view shape. */
function toView(a: AnomalyDetailDto): AnomalyDetail {
  return {
    anomaly_id: a.id,
    code: a.kind ?? null,
    title: a.title,
    description: a.body || null,
    domain: a.domain,
    severity: a.severity,
    detected_at: a.created_at,
    status: a.status ?? "OPEN",
    recommended_action: a.recommended_action ?? null,
    linked_entity_type: a.linked_entity_type ?? null,
    linked_entity_id: a.linked_entity_id ?? null,
    linked_entity_label: a.linked_asset ?? null,
    driver_name: a.driver_name ?? null,
    vehicle_plate: a.vehicle_plate ?? null,
    location_text: a.location_text ?? null,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    evidence: a.evidence_url ? [{ label: t("admin.anomalies.evidence"), value: a.evidence_url }] : [],
  }
}

export function AnomalyDetailScreen({ services, id, onBack, anomaly: anomalyProp }: AnomalyDetailScreenProps) {
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<AnomalyDetail | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    const row = await services.admin.anomalies.getOne(id)
    setFetched(row ? toView(row) : null)
    setLoading(false)
  }, [services, id])

  // Load the feed so `getOne` can resolve from `anomalies`, then track refreshes.
  useEffect(() => {
    void services.admin.anomalies.load().then(refresh)
    const off = services.admin.anomalies.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const anomaly = anomalyProp ?? fetched
  const evidence = anomaly?.evidence ?? []

  if (loading || !anomaly) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-anomaly-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.anomalyDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.anomalies.empty")}
          description={loading ? undefined : t("admin.anomalies.emptyDescription")}
          icon={<Icon name="warning" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-anomaly-detail">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.anomalyDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* Context header */}
      <Card variant="container" accent={accentFor(anomaly.severity)}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="report_problem" size={24} color={theme.colors.error} />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle">{anomaly.title ?? anomaly.code ?? t("common.notAvailable")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[1] }}>
              <Icon name="history" size={16} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {anomaly.detected_at ?? t("common.notAvailable")}
              </Text>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          {anomaly.severity ? <StatusBadge label={anomaly.severity} tone={toneFor(anomaly.severity)} /> : null}
          {anomaly.domain ? <StatusBadge label={anomaly.domain} tone="info" /> : null}
          {anomaly.status ? <StatusBadge label={anomaly.status} tone={anomaly.status === "OPEN" ? "warning" : "neutral"} /> : null}
          {anomaly.code ? <StatusBadge label={anomaly.code} tone="neutral" /> : null}
        </View>
      </Card>

      {/* Description */}
      <Card variant="container" title={t("admin.anomalyDetail.description")}>
        <Text preset="body02">{anomaly.description ?? t("admin.anomalyDetail.noDescription")}</Text>
      </Card>

      {/* Evidence */}
      <Card variant="container" title={t("admin.anomalies.evidence")}>
        {evidence.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.anomalyDetail.noEvidence")}
          </Text>
        ) : (
          <DataTable<AnomalyEvidenceRow>
            testID="anomaly-evidence-table"
            columns={[
              {
                key: "label",
                header: t("admin.anomalyDetail.signal"),
                flex: 2,
                render: (r) => (
                  <Text preset="body02" color={theme.colors.onSurfaceVariant}>
                    {r.label ?? t("common.notAvailable")}
                  </Text>
                ),
              },
              {
                key: "value",
                header: t("admin.anomalyDetail.reading"),
                flex: 1,
                align: "right",
                render: (r) => (
                  <Text preset="bodyStrong" color={r.out_of_range ? theme.colors.error : theme.colors.onSurface}>
                    {r.value ?? t("common.notAvailable")}
                  </Text>
                ),
              },
            ]}
            rows={evidence}
          />
        )}
      </Card>

      {/* Recommended action */}
      <Card variant="container" title={t("admin.anomalies.recommendedAction")} accent={theme.colors.primary}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="assignment" size={20} color={theme.colors.primary} />
          <Text preset="body02" style={{ flex: 1 }}>
            {anomaly.recommended_action ?? t("admin.anomalyDetail.noRecommendedAction")}
          </Text>
        </View>
        <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[3] }}>
          {t("admin.anomalyDetail.readOnlyNote")}
        </Text>
      </Card>

      {/* Linked entity */}
      <Card variant="container" title={t("admin.anomalyDetail.linkedEntity")}>
        <EntityRow
          icon="hub"
          label={anomaly.linked_entity_type ?? t("admin.anomalyDetail.entity")}
          value={anomaly.linked_entity_label ?? anomaly.linked_entity_id}
        />
        <EntityRow icon="person" label={t("admin.anomalyDetail.driver")} value={anomaly.driver_name} />
        <EntityRow icon="local_shipping" label={t("admin.anomalyDetail.vehicle")} value={anomaly.vehicle_plate} />
        <EntityRow
          icon="location_on"
          label={t("admin.anomalyDetail.location")}
          value={
            anomaly.location_text ??
            (anomaly.latitude != null && anomaly.longitude != null ? `${anomaly.latitude}, ${anomaly.longitude}` : null)
          }
        />
      </Card>
    </ScrollView>
  )
}

function EntityRow({
  icon,
  label,
  value,
}: {
  icon: "hub" | "person" | "local_shipping" | "location_on"
  label: string
  value?: string | null
}) {
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing[3],
        paddingVertical: theme.spacing[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outlineVariant,
      }}
    >
      <Icon name={icon} size={24} color={theme.colors.onSurfaceVariant} />
      <View style={{ flex: 1 }}>
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {label}
        </Text>
        <Text preset="body02" style={{ marginTop: theme.spacing[1] }}>
          {value ?? t("common.notAvailable")}
        </Text>
      </View>
    </View>
  )
}
