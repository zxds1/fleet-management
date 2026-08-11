// packages/mobile/src/screens/admin/ExpiringDocsScreen.tsx
//
// Expiring documents (spec `expiring_documents`): three summary StatCards (Expired / Expiring 30d /
// Pending review) above a Carbon DataTable — Driver·Asset / Type / Expiration / Status / Actions.
// Notify + Upload live in `rowActions` so the table row stays a single navigation target.

import React, { useEffect, useMemo, useState } from "react"
import { View, ScrollView, Pressable } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { StatCard } from "@/design/components/StatCard"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Icon } from "@/design/components/Icon"
import { DataTable, type DataTableColumn } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DocumentRow } from "@/core/admin"

export interface ExpiringDocsScreenProps {
  services: Services
  onBack: () => void
  /** Opens `DocumentDetailScreen` for the tapped document. */
  onSelect?: (id: string) => void
}

export function ExpiringDocsScreen({ services, onBack, onSelect }: ExpiringDocsScreenProps) {
  const [docs, setDocs] = useState<DocumentRow[]>(services.admin.documents.documents)
  const [withinDays, setWithinDays] = useState(30)

  const load = async () => {
    await services.admin.documents.load(withinDays)
    setDocs([...services.admin.documents.documents])
  }
  useEffect(() => {
    void load()
    const off = services.admin.documents.onChange(() => setDocs([...services.admin.documents.documents]))
    return off
  }, [services, withinDays])

  // Summary counts drive the StatCard row (danger / warning / info tones per spec).
  const counts = useMemo(() => {
    let expired = 0
    let soon = 0
    let pending = 0
    for (const d of docs) {
      const days = d.days_remaining ?? 0
      if (days <= 0) expired += 1
      else if (days <= 30) soon += 1
      else pending += 1
    }
    return { expired, soon, pending }
  }, [docs])

  const columns: DataTableColumn<DocumentRow>[] = [
    {
      key: "subject",
      header: t("admin.documents.colSubject"),
      flex: 2,
      render: (d) => (
        <Text preset="bodyStrong">{d.subject_name ?? d.document_type ?? t("common.notAvailable")}</Text>
      ),
    },
    {
      key: "type",
      header: t("admin.documents.colType"),
      flex: 2,
      render: (d) => (
        <Text preset="body" color={theme.colors.textSecondary}>
          {d.document_type ?? t("common.notAvailable")}
        </Text>
      ),
    },
    {
      key: "expiration",
      header: t("admin.documents.colExpiration"),
      flex: 2,
      render: (d) => {
        const days = d.days_remaining ?? 0
        const expired = days <= 0
        return (
          <View>
            <Text preset="body" color={expired ? theme.colors.supportError : theme.colors.textPrimary}>
              {d.expires_on ? d.expires_on.slice(0, 10) : t("common.notAvailable")}
            </Text>
            <Text preset="caption" color={theme.colors.textSecondary}>
              {expired
                ? t("driver.documents.expiredAgo", { days: Math.abs(days) })
                : t("driver.documents.expiresIn", { days })}
            </Text>
          </View>
        )
      },
    },
    {
      key: "status",
      header: t("admin.documents.colStatus"),
      flex: 1.5,
      render: (d) => {
        const expired = (d.days_remaining ?? 0) <= 0
        return (
          <StatusBadge
            label={expired ? t("driver.documents.expired") : t("driver.documents.expiringSoon")}
            tone={expired ? "danger" : "warning"}
          />
        )
      },
    },
  ]

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-documents">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("admin.documents.title")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>{t("common.back")}</Button>
      </View>
      <View style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="label" color={theme.colors.textSecondary}>{t("admin.documents.withinDays", { days: withinDays })}</Text>
      </View>

      {/* Summary cards */}
      <View style={{ flexDirection: "row", marginBottom: theme.spacing[4], marginHorizontal: -theme.spacing[2] }}>
        <View style={{ flex: 1, paddingHorizontal: theme.spacing[2] }}>
          <StatCard label={t("admin.documents.statExpired")} value={String(counts.expired)} tone="danger" testID="stat-expired" />
        </View>
        <View style={{ flex: 1, paddingHorizontal: theme.spacing[2] }}>
          <StatCard label={t("admin.documents.statExpiringSoon")} value={String(counts.soon)} tone="warning" testID="stat-expiring" />
        </View>
        <View style={{ flex: 1, paddingHorizontal: theme.spacing[2] }}>
          <StatCard label={t("admin.documents.statPending")} value={String(counts.pending)} tone="info" testID="stat-pending" />
        </View>
      </View>

      {docs.length === 0 ? (
        <EmptyState title={t("admin.documents.empty")} description={t("admin.documents.emptyDescription")} />
      ) : (
        <Card variant="container" style={{ padding: 0 }}>
          <DataTable
            testID="documents-table"
            columns={columns}
            rows={docs}
            onRowPress={onSelect ? (d) => d.document_id && onSelect(d.document_id) : undefined}
            rowActions={(d) => (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("admin.documents.notify")}
                  disabled={!d.document_id}
                  onPress={() => d.document_id && onSelect?.(d.document_id)}
                  testID="document-notify"
                  style={{
                    width: theme.sizing.minTouchTarget,
                    height: theme.sizing.minTouchTarget,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="send" size={theme.sizing.iconMd} color={theme.colors.interactive01} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("admin.documents.upload")}
                  disabled={!d.document_id}
                  onPress={() => d.document_id && onSelect?.(d.document_id)}
                  testID="document-upload"
                  style={{
                    width: theme.sizing.minTouchTarget,
                    height: theme.sizing.minTouchTarget,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="upload_file" size={theme.sizing.iconMd} color={theme.colors.textSecondary} />
                </Pressable>
              </>
            )}
          />
        </Card>
      )}
    </ScrollView>
  )
}
