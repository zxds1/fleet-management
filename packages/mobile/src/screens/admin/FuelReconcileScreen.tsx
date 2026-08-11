// packages/mobile/src/screens/admin/FuelReconcileScreen.tsx
//
// Fuel reconciliation inbox (spec `fuel_reconciliation`): a Pending / Resolved / Ignored segmented
// control over severity-accented rows. Litres and cost are key/value `Text` (facts, not statuses);
// `StatusBadge` is reserved for the verify state.
//
// The **Pending** tab is the photo-first review queue (`GET /admin/fuel/pending`, A1.4): each row is
// triaged AUTO / REVIEW / FLAGGED and shows the derived economics (distance since last refuel and
// cost per km) that make an over-fuelling claim obvious at a glance. Resolved / Ignored continue to
// read the statement-import inbox (`GET /fuel/reconciliation-inbox`), which is a different payload.
import React, { useEffect, useMemo, useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { FuelReconcileRow, FuelPendingRow } from "@/core/admin"

type FuelTab = "pending" | "resolved" | "ignored"

type FuelBadge = FuelPendingRow["badge"]

const TABS: { key: FuelTab; labelKey: string }[] = [
  { key: "pending", labelKey: "admin.fuel.tabPending" },
  { key: "resolved", labelKey: "admin.fuel.tabResolved" },
  { key: "ignored", labelKey: "admin.fuel.tabIgnored" },
]

/** Triage badge → tone/accent. AUTO green, REVIEW amber, FLAGGED red. */
const BADGE_TONE: Record<FuelBadge, BadgeTone> = {
  AUTO: "success",
  REVIEW: "warning",
  FLAGGED: "danger",
}

const BADGE_ACCENT: Record<FuelBadge, string> = {
  AUTO: theme.colors.supportSuccess,
  REVIEW: theme.colors.supportWarning,
  FLAGGED: theme.colors.supportError,
}

const BADGE_LABEL_KEY: Record<FuelBadge, string> = {
  AUTO: "admin.fuel.badgeAuto",
  REVIEW: "admin.fuel.badgeReview",
  FLAGGED: "admin.fuel.badgeFlagged",
}

export interface FuelReconcileScreenProps {
  services: Services
  onBack: () => void
  /** Opens `PurchaseDetailScreen` for the tapped purchase. */
  onSelect?: (purchaseId: string) => void
}

/** `POST /reconciliation/statements` requires `date` strings for both period bounds. */
function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

/** Formats a nullable numeric measurement, falling back to the shared N/A dash. */
function num(value: number | null | undefined, digits = 0): string {
  return value == null ? t("common.notAvailable") : value.toFixed(digits)
}

export function FuelReconcileScreen({ services, onBack, onSelect }: FuelReconcileScreenProps) {
  const [rows, setRows] = useState<FuelReconcileRow[]>(services.admin.fuel.rows)
  const [pending, setPending] = useState<FuelPendingRow[]>(services.admin.fuel.pending)
  const [tab, setTab] = useState<FuelTab>("pending")
  const [actionId, setActionId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [statement, setStatement] = useState({ provider: "", periodStart: "", periodEnd: "", fileId: "" })

  const refresh = () => {
    setRows([...services.admin.fuel.rows])
    setPending([...services.admin.fuel.pending])
  }

  useEffect(() => {
    void services.admin.fuel.load().then(refresh)
    // Photo-first queue is a separate endpoint; a failure there must not blank the inbox.
    void services.admin.fuel.loadPending().catch(() => undefined)
    const off = services.admin.fuel.onChange(refresh)
    return off
  }, [services])

  const doVerify = async (id: string, action: "VERIFY" | "REJECT" | "CLEAR_PAYMENT") => {
    setBusy(true)
    try {
      await services.admin.fuel.verify(id, action === "REJECT" ? { action, rejection_reason: rejectReason } : { action })
      setActionId(null)
      setRejectReason("")
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    if (!statement.provider || !statement.fileId) return
    if (!isIsoDate(statement.periodStart) || !isIsoDate(statement.periodEnd)) return
    setBusy(true)
    try {
      await services.admin.fuel.importStatement({
        provider: statement.provider,
        period_start: statement.periodStart,
        period_end: statement.periodEnd,
        media_object_id: statement.fileId,
      })
    } finally {
      setBusy(false)
      setStatement({ provider: "", periodStart: "", periodEnd: "", fileId: "" })
    }
  }

  // Resolved = verified, ignored = rejected. Both read the statement-import inbox.
  const visible = useMemo(
    () => rows.filter((r) => (tab === "resolved" ? !!r.admin_verified : !!r.rejected_at)),
    [rows, tab],
  )

  // The pending API returns only rows still awaiting a decision, so no client-side filtering.
  const visiblePending: FuelPendingRow[] = pending ?? []

  const flaggedCount = visiblePending.filter((r) => r.badge === "FLAGGED").length

  /** Severity accent from the row's worst open anomaly / verification outcome. */
  const accentFor = (r: FuelReconcileRow): string | undefined => {
    const severity = (r.worst_open_severity ?? "").toUpperCase()
    if (r.rejected_at) return theme.colors.supportError
    if (severity === "CRITICAL" || severity === "HIGH") return theme.colors.supportError
    if (severity === "MEDIUM") return theme.colors.supportWarning
    if (r.admin_verified) return theme.colors.supportSuccess
    return undefined
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-fuel">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("admin.fuel.title")}</Text>
        <Button variant="ghost" onPress={onBack}>{t("common.back")}</Button>
      </View>

      <Card style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="body02">{t("admin.fuel.importStatement")}</Text>
        <Input label={t("admin.fuel.statementProvider")} value={statement.provider} onChangeText={(v) => setStatement({ ...statement, provider: v })} testID="stmt-provider" />
        <Input label={t("admin.fuel.statementPeriod")} value={statement.periodStart} onChangeText={(v) => setStatement({ ...statement, periodStart: v })} placeholder="YYYY-MM-DD" testID="stmt-period" />
        <Input label={t("admin.fuel.statementPeriodEnd")} value={statement.periodEnd} onChangeText={(v) => setStatement({ ...statement, periodEnd: v })} placeholder="YYYY-MM-DD" testID="stmt-period-end" />
        <Input label={t("admin.fuel.statementFile")} value={statement.fileId} onChangeText={(v) => setStatement({ ...statement, fileId: v })} placeholder="uuid" testID="stmt-file" />
        <Button
          variant="secondary"
          loading={busy}
          disabled={!statement.provider || !statement.fileId || !isIsoDate(statement.periodStart) || !isIsoDate(statement.periodEnd)}
          onPress={doImport}
        >
          {t("admin.fuel.importQueued")}
        </Button>
      </Card>

      {/* Segmented control (spec: Carbon tabs with an underline for the active segment). */}
      <View style={{ flexDirection: "row", marginBottom: theme.spacing[4], borderBottomWidth: 1, borderBottomColor: theme.colors.ui03 }}>
        {TABS.map((tabDef) => {
          const active = tab === tabDef.key
          return (
            <View
              key={tabDef.key}
              style={{ flex: 1, borderBottomWidth: 2, borderBottomColor: active ? theme.colors.interactive01 : "transparent" }}
            >
              <Button
                variant="ghost"
                onPress={() => setTab(tabDef.key)}
                testID={`fuel-tab-${tabDef.key}`}
                accessibilityLabel={t(tabDef.labelKey)}
              >
                {t(tabDef.labelKey)}
              </Button>
            </View>
          )
        })}
      </View>

      {tab === "pending" ? (
        <>
          {flaggedCount > 0 ? (
            <Card
              variant="surface"
              accent={theme.colors.supportError}
              style={{ marginBottom: theme.spacing[3] }}
              testID="fuel-anomaly-banner"
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
                <Icon name="warning" size={20} color={theme.colors.supportError} />
                <Text preset="body02" style={{ flex: 1 }}>
                  {t("admin.fuel.anomalyBanner", { count: flaggedCount })}
                </Text>
              </View>
            </Card>
          ) : null}

          {visiblePending.length === 0 ? (
            <EmptyState title={t("admin.fuel.inboxEmpty")} description={t("admin.fuel.inboxEmptyDescription")} />
          ) : (
            visiblePending.map((r) => (
              <Card key={r.fuel_purchase_id} accent={BADGE_ACCENT[r.badge]} style={{ marginBottom: theme.spacing[3] }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!onSelect}
                  onPress={() => onSelect?.(r.fuel_purchase_id)}
                  testID="fuel-pending-row"
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
                      <Icon name="local_gas_station" size={theme.sizing.iconLg} color={BADGE_ACCENT[r.badge]} />
                      <View style={{ flex: 1 }}>
                        <Text preset="body02">{r.vehicle_plate ?? t("common.notAvailable")}</Text>
                        {r.station_name ? (
                          <Text preset="label" color={theme.colors.textSecondary}>
                            {r.station_name}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <StatusBadge label={t(BADGE_LABEL_KEY[r.badge])} tone={BADGE_TONE[r.badge]} />
                  </View>

                  {/* Measurements are key/value labels — not chips. */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[5], marginTop: theme.spacing[3] }}>
                    <Metric label={t("admin.fuel.cost")} value={`KES ${num(r.amount_spent, 2)}`} />
                    <Metric label={t("admin.fuel.litres")} value={`${num(r.liters_pumped, 2)} ${t("common.litres")}`} />
                    <Metric label={t("admin.purchaseDetail.odometer")} value={`${num(r.odometer_km)} ${t("common.km")}`} />
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[5], marginTop: theme.spacing[3] }}>
                    <Metric
                      label={t("admin.fuel.distanceSinceLastRefuel")}
                      value={`${num(r.distance_since_last_refuel)} ${t("common.km")}`}
                    />
                    <Metric label={t("admin.fuel.costPerKm")} value={`KES ${num(r.cost_per_km, 2)}`} />
                  </View>
                </TouchableOpacity>
              </Card>
            ))
          )}
        </>
      ) : visible.length === 0 ? (
        <EmptyState title={t("admin.fuel.inboxEmpty")} description={t("admin.fuel.inboxEmptyDescription")} />
      ) : (
        visible.map((r) => (
          <Card key={r.fuel_purchase_id ?? ""} accent={accentFor(r)} style={{ marginBottom: theme.spacing[3] }}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={!onSelect || !r.fuel_purchase_id}
              onPress={() => r.fuel_purchase_id && onSelect?.(r.fuel_purchase_id)}
              testID="fuel-row"
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
                  <Icon
                    name="local_gas_station"
                    size={theme.sizing.iconLg}
                    color={accentFor(r) ?? theme.colors.interactive01}
                  />
                  <Text preset="body02">{r.vehicle_plate ?? r.driver_name ?? t("common.notAvailable")}</Text>
                </View>
                {/* StatusBadge is reserved for the verification state. */}
                <StatusBadge
                  label={
                    r.rejected_at
                      ? t("admin.fuel.rejected")
                      : r.admin_verified
                        ? t("admin.fuel.verified")
                        : t("admin.fuel.unverified")
                  }
                  tone={r.rejected_at ? "danger" : r.admin_verified ? "success" : "warning"}
                />
              </View>

              {/* Litres and cost are measurements, rendered as key/value labels — not chips. */}
              <View style={{ flexDirection: "row", gap: theme.spacing[5], marginTop: theme.spacing[3] }}>
                <Metric label={t("admin.fuel.litres")} value={`${r.litres ?? t("common.notAvailable")} ${t("common.litres")}`} />
                <Metric label={t("admin.fuel.cost")} value={`${r.currency} ${r.total_cost ?? t("common.notAvailable")}`} />
              </View>

              {r.gauge_before_percent != null && r.gauge_after_percent != null ? (
                <Text preset="label" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
                  {t("admin.fuel.gaugeEvidence")}: {r.gauge_before_percent}% → {r.gauge_after_percent}%
                </Text>
              ) : null}
            </TouchableOpacity>

            {actionId === r.fuel_purchase_id ? (
              <View style={{ marginTop: theme.spacing[3] }}>
                <Input label={t("admin.fuel.rejectReason")} value={rejectReason} onChangeText={setRejectReason} testID="fuel-reject-reason" />
                <Button variant="danger" loading={busy} disabled={!rejectReason} onPress={() => doVerify(r.fuel_purchase_id!, "REJECT")}>
                  {t("admin.fuel.reject")}
                </Button>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
                <Button variant="primary" loading={busy} onPress={() => doVerify(r.fuel_purchase_id!, "VERIFY")}>{t("admin.fuel.verify")}</Button>
                <Button variant="secondary" onPress={() => { setActionId(r.fuel_purchase_id!); setRejectReason("") }}>{t("admin.fuel.reject")}</Button>
              </View>
            )}
          </Card>
        ))
      )}
    </ScrollView>
  )
}

/** Key/value measurement pair. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text preset="label" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <Text preset="body">{value}</Text>
    </View>
  )
}

