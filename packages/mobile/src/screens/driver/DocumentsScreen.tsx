// packages/mobile/src/screens/driver/DocumentsScreen.tsx
//
// B.19 Documents (expiring, scoped). Read-only view of `GET /documents/expiring?within_days=…`
// filtered to the driver's own assets: expiry date + countdown, tap → detail. Admin manages them.
// Self-fetching via `services.feed.listDocuments(withinDays)`.

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

export interface DocSummary {
  document_id: string
  document_type?: string | null
  subject_name?: string | null
  subject_ref?: string | null
  expires_on?: string | null
  days_remaining?: number | null
}

export interface DocumentsScreenProps {
  services: Services
  withinDays?: number
  onSelect: (documentId: string) => void
  onBack: () => void
}

function formatDate(iso?: string | null): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleDateString()
}

export function DocumentsScreen({ services, withinDays = 30, onSelect, onBack }: DocumentsScreenProps) {
  const [documents, setDocuments] = useState<DocSummary[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocuments(await services.feed.listDocuments(withinDays))
    } catch {
      // Offline / unavailable → the empty state covers it.
    } finally {
      setLoading(false)
    }
  }, [services, withinDays])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-documents-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="driver-documents-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Icon name="description" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.documents.title")}</Text>
      </View>
      <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
        {t("driver.documents.subtitle")}
      </Text>
      <View style={{ marginTop: theme.spacing[3], marginBottom: theme.spacing[4] }}>
        <StatusBadge label={t("driver.documents.withinDays", { days: withinDays })} tone="info" />
      </View>

      {documents.length === 0 ? (
        <EmptyState
          icon={<Icon name="description" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.documents.empty")}
          description={loading ? undefined : t("driver.documents.emptyDescription")}
          testID="driver-documents-empty"
        />
      ) : (
        documents.map((d) => {
          const days = d.days_remaining ?? 0
          const expired = days <= 0
          return (
            <Card
              key={d.document_id}
              variant="container"
              style={{ padding: 0 }}
              accent={expired ? theme.colors.supportError : theme.colors.supportWarning}
              testID={`document-${d.document_id}`}
            >
              <ListRow
                title={d.document_type ?? t("driver.documents.documentType")}
                subtitle={d.subject_name ?? d.subject_ref ?? t("driver.documents.subject")}
                onPress={() => onSelect(d.document_id)}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                    <StatusBadge
                      label={
                        expired
                          ? t("driver.documents.expiredAgo", { days: Math.abs(days) })
                          : t("driver.documents.expiresIn", { days })
                      }
                      tone={expired ? "danger" : "warning"}
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
                <Icon
                  name={expired ? "warning" : "calendar_today"}
                  size={theme.sizing.iconSm}
                  color={expired ? theme.colors.error : theme.colors.onSurfaceVariant}
                />
                <Text preset="caption" color={expired ? theme.colors.error : theme.colors.onSurfaceVariant}>
                  {expired
                    ? t("driver.documents.expired")
                    : t("driver.documents.expiresOn", { date: formatDate(d.expires_on) })}
                </Text>
              </View>
            </Card>
          )
        })
      )}
    </ScrollView>
  )
}
