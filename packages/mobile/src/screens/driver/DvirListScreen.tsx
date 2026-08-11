// packages/mobile/src/screens/driver/DvirListScreen.tsx
//
// B.10 DVIR List. Inspection templates (start a new inspection from one) plus the driver's recent
// submissions with review status (SUBMITTED / REVIEWED / FLAGGED) and the BLOCKER quarantine flag.
// Self-fetching: `services.inspections.listTemplates()` + `listSubmissions()` on mount.

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
import type { DvirSummary as DvirRow } from "@/core/driver/inspections"

export interface DvirTemplate {
  id: string
  label: string
}

export interface DvirSummary {
  inspection_id: string
  submitted_at?: string
  vehicle_label?: string | null
  /** DRAFT | SUBMITTED | REVIEWED | FLAGGED */
  status?: string | null
  defect_count?: number | null
  quarantined?: boolean
}

export interface DvirListScreenProps {
  services: Services
  onNew: (templateId?: string) => void
  onSelect: (inspectionId: string) => void
  onBack: () => void
}

/** Map the service read model (`GET /inspections/me`) onto this screen's row shape. */
function toRow(s: DvirRow): DvirSummary {
  return {
    inspection_id: s.inspection_id,
    submitted_at: s.submitted_at,
    vehicle_label: s.vehicle_plate ?? s.template_label ?? s.vehicle_id ?? null,
    status: s.status,
    defect_count: s.defect_count,
    quarantined: s.quarantined,
  }
}


function tone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
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

export function DvirListScreen({ services, onNew, onSelect, onBack }: DvirListScreenProps) {
  const [templates, setTemplates] = useState<DvirTemplate[]>([])
  const [submissions, setSubmissions] = useState<DvirSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // Templates and submissions are independent: one failing must not blank the other.
    const [tpl, subs] = await Promise.allSettled([
      services.inspections.listTemplates(),
      services.inspections.listSubmissions(),
    ])
    if (tpl.status === "fulfilled") setTemplates(tpl.value.map((x) => ({ id: x.id, label: x.label })))
    if (subs.status === "fulfilled") setSubmissions(subs.value.map(toRow))
    setLoading(false)
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="dvir-list-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="dvir-list-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Icon name="fact_check" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.dvir.title")}</Text>
      </View>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.dvir.subtitle")}
      </Text>

      <Button
        onPress={() => onNew()}
        icon={<Icon name="add" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
        label={t("driver.dvir.newInspection")}
        testID="dvir-new"
      />

      {templates.length > 0 ? (
        <View style={{ marginTop: theme.spacing[5] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
            <Icon name="list" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
            <Text preset="label" color={theme.colors.onSurfaceVariant}>
              {t("driver.dvir.templates")}
            </Text>
          </View>
          <Card variant="container" style={{ padding: 0 }}>
            {templates.map((tpl) => (
              <ListRow
                key={tpl.id}
                title={tpl.label}
                onPress={() => onNew(tpl.id)}
                testID={`dvir-template-${tpl.id}`}
                trailing={<Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />}
              />
            ))}
          </Card>
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing[5] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
          <Icon name="history" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <Text preset="label" color={theme.colors.onSurfaceVariant}>
            {t("driver.dvir.recentSubmissions")}
          </Text>
        </View>

        {submissions.length === 0 ? (
          <EmptyState
            icon={<Icon name="fact_check" size={32} color={theme.colors.onSurfaceVariant} />}
            title={loading ? t("common.loading") : t("driver.dvir.empty")}
            description={loading ? undefined : t("driver.dvir.emptyDescription")}
            actionLabel={t("driver.dvir.newInspection")}
            onAction={() => onNew()}
            testID="dvir-list-empty"
          />
        ) : (
          submissions.map((s) => (
            <Card
              key={s.inspection_id}
              variant="container"
              style={{ padding: 0 }}
              accent={s.quarantined ? theme.colors.supportError : undefined}
              testID={`dvir-${s.inspection_id}`}
            >
              <ListRow
                title={s.vehicle_label ?? t("common.notAvailable")}
                subtitle={formatWhen(s.submitted_at)}
                onPress={() => onSelect(s.inspection_id)}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                    <StatusBadge label={t(`driver.dvir.status.${s.status ?? "SUBMITTED"}`)} tone={tone(s.status)} />
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
                {s.defect_count && s.defect_count > 0 ? (
                  <>
                    <Icon name="report_problem" size={theme.sizing.iconSm} color={theme.colors.error} />
                    <Text preset="caption" color={theme.colors.error}>
                      {`${t("driver.dvir.defectsFound")}: ${s.defect_count}`}
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon name="check_circle" size={theme.sizing.iconSm} color={theme.colors.success} />
                    <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                      {t("driver.dvir.noDefects")}
                    </Text>
                  </>
                )}
                {s.quarantined ? (
                  <StatusBadge label={t("driver.dvir.quarantined")} tone="danger" />
                ) : null}
              </View>
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  )
}
