// packages/mobile/src/screens/driver/MyAccidentsScreen.tsx
//
// B.14 My Accidents. Cursor page of the driver's own reports: status, MAYDAY flag and escalation
// state. Tapping a row opens the Accident Detail (B.15). Self-fetching via
// `services.accidents.listMine()`.

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

export interface AccidentSummary {
  accident_id: string
  reference?: string | null
  occurred_at?: string
  location_label?: string | null
  severity?: string | null
  /** REPORTED | ACKNOWLEDGED | UNDER_REVIEW | ESCALATED | RESOLVED | CLOSED */
  status?: string | null
  mayday?: boolean
  escalation_tier?: number | null
}

export interface MyAccidentsScreenProps {
  services: Services
  onSelect: (accidentId: string) => void
  onBack: () => void
}

function statusTone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "RESOLVED":
    case "CLOSED":
      return "success"
    case "ESCALATED":
      return "danger"
    case "UNDER_REVIEW":
      return "warning"
    case "ACKNOWLEDGED":
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

export function MyAccidentsScreen({ services, onSelect, onBack }: MyAccidentsScreenProps) {
  const [accidents, setAccidents] = useState<AccidentSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAccidents(await services.accidents.listMine())
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
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="my-accidents-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="my-accidents-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], marginBottom: theme.spacing[4] }}>
        <Icon name="report_problem" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.accident.myAccidents")}</Text>
      </View>

      {accidents.length === 0 ? (
        <EmptyState
          icon={<Icon name="report_problem" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.accident.empty")}
          description={loading ? undefined : t("driver.accident.emptyDescription")}
          testID="my-accidents-empty"
        />
      ) : (
        accidents.map((a) => (
          <Card
            key={a.accident_id}
            variant="container"
            style={{ padding: 0 }}
            accent={a.mayday ? theme.colors.supportError : undefined}
            testID={`accident-${a.accident_id}`}
          >
            <ListRow
              title={a.reference ?? formatWhen(a.occurred_at)}
              subtitle={formatWhen(a.occurred_at)}
              onPress={() => onSelect(a.accident_id)}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                  <StatusBadge label={t(`driver.accident.status.${a.status ?? "REPORTED"}`)} tone={statusTone(a.status)} />
                  <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />
                </View>
              }
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                gap: theme.spacing[2],
                paddingHorizontal: theme.spacing[5],
                paddingVertical: theme.spacing[3],
              }}
            >
              <Icon name="location_on" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ flexShrink: 1 }}>
                {a.location_label ?? t("driver.accident.locationUnavailable")}
              </Text>
              {a.mayday ? <StatusBadge label={t("driver.accident.maydayFlag")} tone="danger" /> : null}
              {a.severity ? <StatusBadge label={a.severity} tone="warning" /> : null}
              {a.escalation_tier !== null && a.escalation_tier !== undefined ? (
                <StatusBadge label={t("admin.accidents.escalationTier", { tier: a.escalation_tier })} tone="info" />
              ) : null}
            </View>
          </Card>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button
          variant="secondary"
          onPress={() => void load()}
          loading={loading}
          label={t("common.pullToRefresh")}
          testID="my-accidents-refresh"
        />
      </View>
    </ScrollView>
  )
}
