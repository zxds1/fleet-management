// packages/mobile/src/screens/admin/AnomalyFeedScreen.tsx
//
// Anomaly feed (spec `admin_anomaly_feed`): each entry is a `border-l-4` severity-accented card with
// a leading domain glyph in the severity colour, so triage is possible without reading the chips.
import React, { useEffect, useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Icon, type IconName } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { Anomaly } from "@/core/driver/feed"

export interface AnomalyFeedScreenProps {
  services: Services
  onBack: () => void
  /** Opens `AnomalyDetailScreen` for the tapped anomaly. */
  onSelect?: (id: string) => void
}

const severityTone = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" } as const

/** Severity accent (4px left border + glyph tint). */
const severityColor: Record<Anomaly["severity"], string> = {
  LOW: theme.colors.outlineVariant,
  MEDIUM: theme.colors.supportInfo,
  HIGH: theme.colors.supportWarning,
  CRITICAL: theme.colors.supportError,
}

/** Domain glyph from the spec vocabulary (see `iconMap.ts`). */
const domainIcon: Record<Anomaly["domain"], IconName> = {
  FUEL: "local_gas_station",
  HOS: "warning",
  ACCIDENT: "report_problem",
  MAINTENANCE: "build",
  SECURITY: "gavel",
}

export function AnomalyFeedScreen({ services, onBack, onSelect }: AnomalyFeedScreenProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>(services.admin.anomalies.anomalies)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      await services.admin.anomalies.load()
      setAnomalies([...services.admin.anomalies.anomalies])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    const off = services.admin.anomalies.onChange(() => setAnomalies([...services.admin.anomalies.anomalies]))
    return off
  }, [services])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-anomalies">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("admin.anomalies.title")}</Text>
        <Button variant="ghost" onPress={onBack}>{t("common.back")}</Button>
      </View>

      {anomalies.length === 0 ? (
        <EmptyState title={t("admin.anomalies.empty")} description={t("admin.anomalies.emptyDescription")} />
      ) : (
        anomalies.map((a) => {
          const accent = severityColor[a.severity]
          return (
            <Card key={a.id} accent={accent} style={{ marginBottom: theme.spacing[3] }}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!onSelect}
                onPress={() => onSelect?.(a.id)}
                testID="anomaly-row"
                style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}
              >
                <Icon name={domainIcon[a.domain]} size={theme.sizing.iconLg} color={accent} />
                <View style={{ flex: 1 }}>
                  <Text preset="body02">{a.title}</Text>
                  {a.body ? <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing[1] }}>{a.body}</Text> : null}
                  <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2], alignItems: "center" }}>
                    <StatusBadge label={a.domain} tone="info" />
                    <StatusBadge label={a.severity} tone={severityTone[a.severity]} />
                  </View>
                </View>
              </TouchableOpacity>
            </Card>
          )
        })
      )}
      <View style={{ marginTop: theme.spacing[3] }}>
        <Button variant="ghost" loading={loading} onPress={() => void load()}>{t("common.pullToRefresh")}</Button>
      </View>
    </ScrollView>
  )
}
