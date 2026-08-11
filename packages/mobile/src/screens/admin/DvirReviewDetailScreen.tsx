// packages/mobile/src/screens/admin/DvirReviewDetailScreen.tsx
//
// C.9 DVIR Review Detail. Shows the inspection items (pass/fail, photos, notes) and the two
// terminal actions: **Verify** (locks the record, stamps `verified_by`/`verified_at`) and **Flag**
// (requires `flag_reason`). Once locked, corrected fields are read-only until an unlock —
// the server answers `409 UNLOCK_REQUIRED` otherwise, so we disable editing client-side too.
//
// Visual reference: `admin_dvir_review_detail` (bento cards, `border-l-4` severity accent per
// defect, photo strip, manager review/action block).

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
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { VerificationRow } from "@/core/admin"

/** Minimal shape of `GET /inspections/{id}` — fields optional so a partial cache renders. */
export interface DvirItemPhoto {
  media_object_id?: string | null
  uri?: string | null
}

export interface DvirItem {
  item_id?: string | null
  item_code?: string | null
  label?: string | null
  /** `PASS` | `FAIL` | `NA` */
  result?: string | null
  /** `BLOCKER` | `MAJOR` | `MINOR` */
  severity?: string | null
  notes?: string | null
  corrected_value?: string | null
  photos?: DvirItemPhoto[] | null
}

export interface DvirDetail {
  inspection_id?: string | null
  shift_id?: string | null
  inspection_type?: string | null
  submitted_at?: string | null
  driver_name?: string | null
  driver_id?: string | null
  vehicle_plate?: string | null
  vehicle_id?: string | null
  odometer_km?: number | null
  /** `PASS` | `FAIL` */
  overall_result?: string | null
  /** `PENDING` | `VERIFIED` | `FLAGGED` */
  verification_status?: string | null
  verified_by?: string | null
  verified_at?: string | null
  flag_reason?: string | null
  locked?: boolean | null
  asset_quarantined?: boolean | null
  items?: DvirItem[] | null
}

export interface DvirReviewDetailScreenProps {
  services: Services
  /** Shift selected in `DvirReviewScreen`. */
  id?: string
  onBack: () => void
  /** Optional overrides — the screen fetches its own data when these are omitted. */
  dvir?: DvirDetail
  onVerify?: () => void
  onFlag?: (reason: string) => void
}

function severityAccent(severity?: string | null): string {
  if (severity === "BLOCKER" || severity === "CRITICAL") return theme.colors.supportError
  if (severity === "MAJOR") return theme.colors.supportWarning
  return theme.colors.outlineVariant
}

/** Maps the reused `VerificationRow` (detail payload == inbox row) onto this screen's view shape. */
function toView(row: VerificationRow): DvirDetail {
  const blocking = Number(row.blocking_failures ?? 0)
  const defects = row.defect_count != null && Number.isFinite(row.defect_count) ? row.defect_count : null
  return {
    shift_id: row.shift_id,
    submitted_at: row.clock_in_at ?? row.operational_date ?? null,
    driver_name: row.driver_name ?? null,
    vehicle_plate: row.vehicle_plate ?? null,
    odometer_km: null,
    overall_result: (Number.isFinite(blocking) && blocking > 0) || (defects ?? 0) > 0 ? "FAIL" : "PASS",
    verification_status: row.verification_status ?? "PENDING",
    flag_reason: row.flag_reason ?? null,
    locked: row.verification_status === "VERIFIED",
  }
}

export function DvirReviewDetailScreen({
  services,
  id,
  onBack,
  dvir: dvirProp,
  onVerify,
  onFlag,
}: DvirReviewDetailScreenProps) {
  const [flagging, setFlagging] = useState(false)
  const [flagReason, setFlagReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<DvirDetail | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    const row = await services.admin.verification.getOne(id)
    setFetched(row ? toView(row) : null)
    setLoading(false)
  }, [services, id])

  // Load the inbox so `getOne` can resolve from `rows`, then subscribe to verify/flag mutations.
  useEffect(() => {
    void services.admin.verification.load().then(refresh)
    const off = services.admin.verification.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const dvir = dvirProp ?? fetched
  const items = dvir?.items ?? []
  const failedItems = items.filter((i) => i.result === "FAIL")
  const status = dvir?.verification_status ?? "PENDING"
  // Locked after verification: corrected fields are read-only until unlock (409 UNLOCK_REQUIRED).
  const locked = dvir?.locked === true || status === "VERIFIED"

  const verify = async () => {
    setBusy(true)
    try {
      if (onVerify) onVerify()
      else if (id) await services.admin.verification.verify(id, { action: "VERIFY" })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const flag = async () => {
    if (!flagReason) return
    setBusy(true)
    try {
      if (onFlag) onFlag(flagReason)
      else if (id) await services.admin.verification.verify(id, { action: "FLAG", flagReason })
      setFlagging(false)
      setFlagReason("")
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (loading || !dvir) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-dvir-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.dvirDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.dvirReview.empty")}
          description={loading ? undefined : t("admin.dvirReview.emptyDescription")}
          icon={<Icon name="fact_check" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-dvir-detail">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.dvirDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* Header summary */}
      <Card
        variant="container"
        accent={dvir.overall_result === "FAIL" ? theme.colors.supportError : theme.colors.supportSuccess}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
          <Icon
            name="fact_check"
            size={24}
            color={dvir.overall_result === "FAIL" ? theme.colors.error : theme.colors.success}
          />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle">{dvir.inspection_type ?? t("admin.dvirDetail.inspection")}</Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {t("admin.dvirDetail.submittedAt", { at: dvir.submitted_at ?? t("common.notAvailable") })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          <StatusBadge
            label={dvir.overall_result === "FAIL" ? t("admin.dvirDetail.failed") : t("admin.dvirDetail.passed")}
            tone={dvir.overall_result === "FAIL" ? "danger" : "success"}
          />
          <StatusBadge
            label={status}
            tone={status === "VERIFIED" ? "success" : status === "FLAGGED" ? "danger" : "warning"}
          />
          {dvir.asset_quarantined ? <StatusBadge label={t("admin.dvirReview.quarantined")} tone="danger" /> : null}
          {locked ? <StatusBadge label={t("admin.dvirDetail.locked")} tone="neutral" /> : null}
        </View>
      </Card>

      {/* Vehicle & driver */}
      <Card variant="container" title={t("admin.dvirDetail.vehicleAndDriver")}>
        <MetaRow icon="local_shipping" label={t("admin.dvirDetail.vehicle")} value={dvir.vehicle_plate ?? dvir.vehicle_id} />
        <MetaRow icon="person" label={t("admin.dvirDetail.driver")} value={dvir.driver_name ?? dvir.driver_id} />
        <MetaRow
          icon="speed"
          label={t("admin.dvirDetail.odometer")}
          value={dvir.odometer_km != null ? `${dvir.odometer_km} ${t("common.km")}` : null}
        />
      </Card>

      {/* Items */}
      <Card variant="container" title={t("admin.dvirDetail.items")} subtitle={t("admin.dvirDetail.itemsSummary", { failed: failedItems.length, total: items.length })}>
        {items.length === 0 ? (
          <EmptyState
            title={t("admin.dvirDetail.noItems")}
            icon={<Icon name="list" size={32} color={theme.colors.outline} />}
          />
        ) : (
          items.map((item, i) => {
            const failed = item.result === "FAIL"
            return (
              <Card
                key={item.item_id ?? item.item_code ?? i}
                variant="surface"
                accent={failed ? severityAccent(item.severity) : theme.colors.supportSuccess}
                style={{ marginBottom: theme.spacing[3] }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing[3] }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flex: 1 }}>
                    <Icon
                      name={failed ? "warning" : "check_circle"}
                      size={20}
                      color={failed ? theme.colors.error : theme.colors.success}
                    />
                    <Text preset="bodyStrong" style={{ flex: 1 }}>
                      {item.label ?? item.item_code ?? t("common.notAvailable")}
                    </Text>
                  </View>
                  <StatusBadge
                    label={item.severity ?? (failed ? t("admin.dvirDetail.fail") : t("admin.dvirDetail.pass"))}
                    tone={failed ? (item.severity === "BLOCKER" ? "danger" : "warning") : "success"}
                  />
                </View>
                {item.notes ? (
                  <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[3] }}>
                    {item.notes}
                  </Text>
                ) : null}
                {item.corrected_value ? (
                  <View style={{ marginTop: theme.spacing[3] }}>
                    <Text preset="label" color={theme.colors.onSurfaceVariant}>
                      {t("admin.dvirDetail.correctedValue")}
                    </Text>
                    <Text preset="body02" style={{ marginTop: theme.spacing[1] }}>
                      {item.corrected_value}
                    </Text>
                  </View>
                ) : null}
                {item.photos && item.photos.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
                    {item.photos.map((p, pi) => (
                      <View
                        key={p.media_object_id ?? pi}
                        style={{
                          width: 88,
                          height: 88,
                          backgroundColor: theme.colors.surfaceContainerHigh,
                          borderWidth: 1,
                          borderColor: theme.colors.outlineVariant,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {p.uri ? (
                          <Image source={{ uri: p.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                        ) : (
                          <Icon name="image" size={24} color={theme.colors.outline} />
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            )
          })
        )}
      </Card>

      {/* Review & action */}
      <Card variant="container" title={t("admin.dvirDetail.reviewAction")}>
        {locked ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
            <Icon name="verified_user" size={24} color={theme.colors.success} />
            <View style={{ flex: 1 }}>
              <Text preset="body02">
                {t("admin.dvirDetail.verifiedBy", {
                  user: dvir.verified_by ?? t("common.notAvailable"),
                  at: dvir.verified_at ?? t("common.notAvailable"),
                })}
              </Text>
              <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
                {t("admin.dvirDetail.unlockRequired")}
              </Text>
            </View>
          </View>
        ) : flagging ? (
          <View>
            <Input
              label={t("admin.dvirReview.flagReason")}
              value={flagReason}
              onChangeText={setFlagReason}
              required
              multiline
              testID="dvir-detail-flag-reason"
            />
            <View style={{ gap: theme.spacing[3] }}>
              <Button variant="danger" loading={busy} disabled={!flagReason} onPress={() => void flag()} testID="dvir-detail-flag-submit">
                {t("admin.dvirReview.flag")}
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setFlagging(false)
                  setFlagReason("")
                }}
              >
                {t("common.cancel")}
              </Button>
            </View>
          </View>
        ) : (
          <View style={{ gap: theme.spacing[3] }}>
            {dvir.flag_reason ? (
              <Text preset="body02" color={theme.colors.error}>
                {dvir.flag_reason}
              </Text>
            ) : null}
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {t("admin.dvirDetail.verifyHelp")}
            </Text>
            <Button
              variant="primary"
              loading={busy}
              onPress={() => void verify()}
              icon={<Icon name="check_circle" size={20} color={theme.colors.onPrimary} />}
              testID="dvir-detail-verify"
            >
              {t("admin.dvirReview.verify")}
            </Button>
            <Button
              variant="secondary"
              onPress={() => setFlagging(true)}
              icon={<Icon name="report_problem" size={20} color={theme.colors.primary} />}
              testID="dvir-detail-flag"
            >
              {t("admin.dvirReview.flag")}
            </Button>
          </View>
        )}
      </Card>
    </ScrollView>
  )
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: "local_shipping" | "person" | "speed"
  label: string
  value?: string | null
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3], marginBottom: theme.spacing[3] }}>
      <Icon name={icon} size={20} color={theme.colors.onSurfaceVariant} />
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
