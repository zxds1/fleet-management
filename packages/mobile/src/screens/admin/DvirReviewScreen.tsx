// packages/mobile/src/screens/admin/DvirReviewScreen.tsx
//
// DVIR review queue (spec `dvir_review_queue`): FAILED/FLAGGED shifts carry an error accent, an
// `error` glyph and a "Defects found (n)" sub-line; everything else shows the `pending_actions`
// glyph. Verify/Flag actions and navigation are unchanged.
import React, { useEffect, useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { VerificationRow } from "@/core/admin"

/** Failed items for a queue row: the projected `defect_count`, else blocking + warning failures. */
function defectCount(r: VerificationRow): number {
  if (r.defect_count != null && Number.isFinite(r.defect_count)) return r.defect_count
  const blocking = Number(r.blocking_failures ?? 0)
  const warning = Number(r.warning_failures ?? 0)
  return (Number.isFinite(blocking) ? blocking : 0) + (Number.isFinite(warning) ? warning : 0)
}

export interface DvirReviewScreenProps {
  services: Services
  onBack: () => void
  /** Opens `DvirReviewDetailScreen` for the tapped shift. */
  onSelect?: (shiftId: string) => void
}

export function DvirReviewScreen({ services, onBack, onSelect }: DvirReviewScreenProps) {
  const [rows, setRows] = useState(services.admin.verification.rows)
  const [flagId, setFlagId] = useState<string | null>(null)
  const [flagReason, setFlagReason] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = () => setRows([...services.admin.verification.rows])
  useEffect(() => {
    void services.admin.verification.load().then(refresh)
    const off = services.admin.verification.onChange(refresh)
    return off
  }, [services])

  const verify = async (id: string) => {
    setBusy(true)
    try {
      await services.admin.verification.verify(id, { action: "VERIFY" })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const flag = async (id: string) => {
    if (!flagReason) return
    setBusy(true)
    try {
      await services.admin.verification.verify(id, { action: "FLAG", flagReason })
      setFlagId(null)
      setFlagReason("")
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-dvir">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("admin.dvirReview.title")}</Text>
        <Button variant="ghost" onPress={onBack}>{t("common.back")}</Button>
      </View>

      {rows.length === 0 ? (
        <EmptyState title={t("admin.dvirReview.empty")} description={t("admin.dvirReview.emptyDescription")} />
      ) : (
        rows.map((r) => {
          const failed = r.verification_status === "FLAGGED" || defectCount(r) > 0
          const defects = defectCount(r)
          return (
            <Card
              key={r.shift_id ?? ""}
              accent={failed ? theme.colors.error : undefined}
              style={{ marginBottom: theme.spacing[3] }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!onSelect || !r.shift_id}
                onPress={() => r.shift_id && onSelect?.(r.shift_id)}
                testID="dvir-row"
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
                  <Icon
                    name={failed ? "error" : "pending_actions"}
                    size={theme.sizing.iconLg}
                    color={failed ? theme.colors.error : theme.colors.textSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text preset="body02">{r.driver_name ?? r.vehicle_plate ?? t("common.notAvailable")}</Text>
                    {defects > 0 ? (
                      <Text preset="label" color={theme.colors.error} style={{ marginTop: theme.spacing[1] }}>
                        {t("admin.dvirReview.defectsFound", { count: defects })}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2], alignItems: "center" }}>
                      {r.verification_status ? (
                        <StatusBadge
                          label={r.verification_status}
                          tone={r.verification_status === "VERIFIED" ? "success" : r.verification_status === "FLAGGED" ? "danger" : "warning"}
                        />
                      ) : null}
                      {r.state ? <StatusBadge label={r.state} tone="neutral" /> : null}
                    </View>
                    {r.flag_reason ? (
                      <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing[1] }}>{r.flag_reason}</Text>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>

              {flagId === r.shift_id ? (
                <View style={{ marginTop: theme.spacing[3] }}>
                  <Input
                    label={t("admin.dvirReview.flagReason")}
                    value={flagReason}
                    onChangeText={setFlagReason}
                    testID="dvir-flag-reason"
                  />
                  <Button variant="danger" loading={busy} disabled={!flagReason} onPress={() => flag(r.shift_id!)}>
                    {t("admin.dvirReview.flag")}
                  </Button>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
                  <Button variant="primary" loading={busy} onPress={() => verify(r.shift_id!)}>{t("admin.dvirReview.verify")}</Button>
                  <Button variant="secondary" onPress={() => { setFlagId(r.shift_id!); setFlagReason("") }}>{t("admin.dvirReview.flag")}</Button>
                </View>
              )}
            </Card>
          )
        })
      )}
    </ScrollView>
  )
}
