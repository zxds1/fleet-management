// packages/mobile/src/screens/admin/DocumentDetailScreen.tsx
//
// C.16 Document Detail. Document metadata, expiry countdown and the linked asset (vehicle or
// driver). Full document management is out of scope for v1, so the only write available to the
// admin is a free-text renewal note.
//
// Visual reference: `admin_document_detail` (scan viewer with rotate/zoom/download affordances,
// verification-status list, extracted-data table, expiry highlighted on error-container).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView, Image } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { DataTable } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { DocumentDetail as DocumentDetailDto } from "@/core/admin"

/** Minimal shape of `GET /documents/{id}` (row of `GET /documents/expiring`). */
export interface DocumentDetail {
  document_id?: string | null
  document_type?: string | null
  document_number?: string | null
  issuer?: string | null
  issued_on?: string | null
  expires_on?: string | null
  days_remaining?: number | null
  /** `VALID` | `EXPIRING` | `EXPIRED` | `PENDING_VERIFICATION` */
  status?: string | null
  /** `VEHICLE` | `DRIVER` */
  subject_type?: string | null
  subject_id?: string | null
  subject_name?: string | null
  vehicle_plate?: string | null
  scan_uri?: string | null
  renewal_note?: string | null
  noted_by?: string | null
  noted_at?: string | null
  uploaded_at?: string | null
  verified_at?: string | null
}

export interface DocumentDetailScreenProps {
  services: Services
  /** Document selected in `ExpiringDocsScreen`. */
  id?: string
  onBack: () => void
  /** Optional overrides — the screen fetches its own data when these are omitted. */
  document?: DocumentDetail
  onNoteRenewal?: (note: string) => void
}

/** Maps the `DocumentDetail` DTO from `services.admin.documents.getOne` onto this screen's view shape. */
function toView(dto: DocumentDetailDto): DocumentDetail {
  return {
    document_id: dto.document_id ?? null,
    document_type: dto.document_type ?? null,
    expires_on: dto.expires_on,
    days_remaining: dto.days_remaining,
    subject_id: dto.subject_id ?? null,
    subject_name: dto.subject_name ?? null,
    vehicle_plate: dto.linked_asset ?? null,
    renewal_note: dto.renewal_note ?? null,
  }
}

export function DocumentDetailScreen({
  services,
  id,
  onBack,
  document: documentProp,
  onNoteRenewal,
}: DocumentDetailScreenProps) {
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<DocumentDetail | null>(null)
  const [note, setNote] = useState(documentProp?.renewal_note ?? "")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    const dto = await services.admin.documents.getOne(id)
    const view = dto ? toView(dto) : null
    setFetched(view)
    if (view?.renewal_note) setNote(view.renewal_note)
    setLoading(false)
  }, [services, id])

  // Load the expiring list so `getOne` can resolve from `documents`, then track refreshes.
  useEffect(() => {
    void services.admin.documents.load().then(refresh)
    const off = services.admin.documents.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const document = documentProp ?? fetched
  const days = document?.days_remaining
  const expired = days != null && days <= 0
  const expiring = days != null && days > 0 && days <= 30

  const save = async () => {
    if (!note) return
    setBusy(true)
    try {
      if (onNoteRenewal) {
        onNoteRenewal(note)
      } else if (id) {
        await services.admin.documents.renewalNote(id, note)
        setNote("")
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading || !document) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-document-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.documentDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.documents.empty")}
          description={loading ? undefined : t("admin.documents.emptyDescription")}
          icon={<Icon name="description" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-document-detail">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.documentDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* Header + expiry */}
      <Card
        variant="container"
        accent={expired ? theme.colors.supportError : expiring ? theme.colors.supportWarning : theme.colors.supportSuccess}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="description" size={24} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle">{document.document_type ?? t("common.notAvailable")}</Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
              {document.document_number ?? t("common.notAvailable")}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          <StatusBadge
            label={
              expired
                ? t("driver.documents.expired")
                : t("driver.documents.expiresIn", { days: days ?? 0 })
            }
            tone={expired ? "danger" : expiring ? "warning" : "success"}
          />
          {document.status ? <StatusBadge label={document.status} tone="neutral" /> : null}
        </View>
      </Card>

      {/* Scan viewer */}
      <Card variant="container" title={t("admin.documentDetail.scan")}>
        <View
          style={{
            height: 220,
            backgroundColor: theme.colors.surfaceContainerHigh,
            borderWidth: 1,
            borderColor: theme.colors.outlineVariant,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {document.scan_uri ? (
            <Image source={{ uri: document.scan_uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          ) : (
            <View style={{ alignItems: "center", gap: theme.spacing[2] }}>
              <Icon name="description" size={32} color={theme.colors.outline} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t("admin.documentDetail.noScan")}
              </Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[4], marginTop: theme.spacing[3], alignItems: "center" }}>
          <Icon name="rotate_right" size={24} color={theme.colors.onSurfaceVariant} />
          <Icon name="zoom_in" size={24} color={theme.colors.onSurfaceVariant} />
          <Icon name="download" size={24} color={theme.colors.onSurfaceVariant} />
        </View>
      </Card>

      {/* Metadata */}
      <Card variant="container" title={t("admin.documentDetail.metadata")}>
        <DataTable<{ label: string; value: string; danger?: boolean }>
          testID="document-metadata-table"
          columns={[
            {
              key: "label",
              header: t("admin.documentDetail.field"),
              flex: 1,
              render: (r) => (
                <Text preset="label" color={theme.colors.onSurfaceVariant}>
                  {r.label}
                </Text>
              ),
            },
            {
              key: "value",
              header: t("admin.documentDetail.value"),
              flex: 1,
              align: "right",
              render: (r) => (
                <Text preset="body02" color={r.danger ? theme.colors.error : theme.colors.onSurface}>
                  {r.value}
                </Text>
              ),
            },
          ]}
          rows={[
            { label: t("admin.documentDetail.documentType"), value: document.document_type ?? t("common.notAvailable") },
            { label: t("admin.documentDetail.documentNumber"), value: document.document_number ?? t("common.notAvailable") },
            { label: t("admin.documentDetail.issuer"), value: document.issuer ?? t("common.notAvailable") },
            { label: t("admin.documentDetail.issuedOn"), value: document.issued_on ?? t("common.notAvailable") },
            { label: t("admin.documentDetail.expiresOn"), value: document.expires_on ?? t("common.notAvailable"), danger: expired || expiring },
            { label: t("admin.documentDetail.uploadedAt"), value: document.uploaded_at ?? t("common.notAvailable") },
            { label: t("admin.documentDetail.verifiedAt"), value: document.verified_at ?? t("common.notAvailable") },
          ]}
        />
      </Card>

      {/* Linked asset */}
      <Card variant="container" title={t("admin.documentDetail.linkedAsset")}>
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing[3],
            paddingVertical: theme.spacing[3],
          }}
        >
          <Icon
            name={document.subject_type === "VEHICLE" ? "local_shipping" : "person"}
            size={24}
            color={theme.colors.onSurfaceVariant}
          />
          <View style={{ flex: 1 }}>
            <Text preset="label" color={theme.colors.onSurfaceVariant}>
              {document.subject_type ?? t("admin.documentDetail.subject")}
            </Text>
            <Text preset="body02" style={{ marginTop: theme.spacing[1] }}>
              {document.subject_name ?? document.vehicle_plate ?? document.subject_id ?? t("common.notAvailable")}
            </Text>
          </View>
          <Icon name="chevron_right" size={24} color={theme.colors.outline} />
        </View>
      </Card>

      {/* Renewal note */}
      <Card variant="container" title={t("admin.documentDetail.renewalNote")}>
        <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[3] }}>
          {t("admin.documentDetail.renewalNoteHelp")}
        </Text>
        <Input
          label={t("admin.documentDetail.renewalNote")}
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={t("admin.documentDetail.renewalNotePlaceholder")}
          testID="document-renewal-note"
        />
        {document.noted_by ? (
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[3] }}>
            {t("admin.documentDetail.notedBy", {
              user: document.noted_by,
              at: document.noted_at ?? t("common.notAvailable"),
            })}
          </Text>
        ) : null}
        <Button variant="primary" loading={busy} disabled={!note} onPress={save} testID="document-note-renewal">
          {t("admin.documentDetail.saveNote")}
        </Button>
      </Card>
    </ScrollView>
  )
}
