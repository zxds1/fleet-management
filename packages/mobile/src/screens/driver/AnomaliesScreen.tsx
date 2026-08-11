// packages/mobile/src/screens/driver/AnomaliesScreen.tsx
import React from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Icon } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Anomaly } from "@/core/driver/feed"

export interface AnomaliesScreenProps {
  anomalies: Anomaly[]
  loading: boolean
  onRefresh: () => void
  onBack: () => void
}

const SEVERITY_TONE: Record<Anomaly["severity"], "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
}

const SEVERITY_ACCENT: Record<Anomaly["severity"], string> = {
  LOW: theme.colors.outline,
  MEDIUM: theme.colors.info,
  HIGH: theme.colors.warning,
  CRITICAL: theme.colors.error,
}

const SEVERITY_ICON: Record<Anomaly["severity"], "info" | "warning" | "error" | "report_problem"> = {
  LOW: "info",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "error",
}

export function AnomaliesScreen({ anomalies, loading, onRefresh, onBack }: AnomaliesScreenProps) {
  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="anomalies-screen">
      <Text preset="heading03" style={{ marginBottom: theme.spacing[4] }}>
        {t("admin.anomalies.title")}
      </Text>

      {anomalies.length === 0 && !loading ? (
        <EmptyState title={t("admin.anomalies.empty")} description={t("admin.anomalies.emptyDescription")} />
      ) : (
        anomalies.map((a) => (
          <Card key={a.id} accent={SEVERITY_ACCENT[a.severity]} style={{ marginBottom: theme.spacing[3] }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: theme.spacing[3] }}>
                <Icon name={SEVERITY_ICON[a.severity]} size={theme.sizing.iconLg} color={SEVERITY_ACCENT[a.severity]} />
                <Text preset="bodyStrong" style={{ flex: 1 }}>
                  {a.title}
                </Text>
              </View>
              <StatusBadge tone={SEVERITY_TONE[a.severity]} label={a.severity} />
            </View>
            <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>
              {t("admin.anomalies.domain")}: {a.domain}
            </Text>
            {a.body ? <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>{a.body}</Text> : null}
            <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>
              {new Date(a.created_at).toLocaleString()}
            </Text>
          </Card>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button onPress={onRefresh} loading={loading}>
          {t("common.pullToRefresh")}
        </Button>
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="ghost" onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
      </View>
    </ScrollView>
  )
}
