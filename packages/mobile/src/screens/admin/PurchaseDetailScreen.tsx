// packages/mobile/src/screens/admin/PurchaseDetailScreen.tsx
//
// C.11 Fuel Purchase Detail. Purchase data, gauge evidence and the detected anomaly list, plus the
// permission-gated actions:
//   • `fuel:verify`          → **Verify** / **Reject** (reason required)
//   • `finance:clear_payment`→ **Clear payment**, only once `admin_verified` is true (C6.1)
// Writes bind to `POST /fuel/purchases/{id}/verify`.
//
// Visual reference: `fuel_reconciliation` + `admin_purchase_detail` (bento detail card, anomaly
// block on error-container, receipt scan tile, action bar).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView, Image, Modal, TouchableOpacity } from "react-native"
import { OCR_CONFIDENCE_THRESHOLD } from "@fleet/shared/mobile"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { DataTable } from "@/design/components/DataTable"
import { BottomSheet } from "@/design/components/BottomSheet"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { FuelReconcileRow, FuelPendingRow } from "@/core/admin"

/** Minimal shape of the reconciliation-inbox row / `GET /fuel/purchases/{id}`. */
export interface PurchaseAnomaly {
  anomaly_id?: string | null
  code?: string | null
  label?: string | null
  detail?: string | null
  /** `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` */
  severity?: string | null
}

export interface PurchaseDetail {
  fuel_purchase_id?: string | null
  purchased_at?: string | null
  driver_name?: string | null
  driver_id?: string | null
  vehicle_plate?: string | null
  vehicle_id?: string | null
  station_name?: string | null
  location_text?: string | null
  fuel_type?: string | null
  litres?: number | null
  adjusted_litres?: number | null
  unit_price?: number | null
  total_cost?: number | null
  currency?: string | null
  payment_method?: string | null
  odometer_km?: number | null
  gauge_before_percent?: number | null
  gauge_after_percent?: number | null
  expected_rise_percent?: number | null
  actual_rise_percent?: number | null
  deviation_percent?: number | null
  gauge_before_uri?: string | null
  gauge_after_uri?: string | null
  receipt_uri?: string | null
  admin_verified?: boolean | null
  verified_by?: string | null
  verified_at?: string | null
  rejection_reason?: string | null
  payment_cleared?: boolean | null
  /** `PENDING` | `VERIFIED` | `REJECTED` | `CLEARED` */
  status?: string | null
  anomalies?: PurchaseAnomaly[] | null

  // ---- Photo-first review (A1.4) ----
  /** Raw OCR field bag off the receipt scan. */
  ocrRawData?: Record<string, unknown> | null
  /** True once the driver overrode an OCR value before submitting (A1.4). */
  driverCorrected?: boolean | null
  /** 0..1 OCR confidence. Below `LOW_CONFIDENCE` the review banner is raised. */
  confidenceScore?: number | null
  distanceSinceLastRefuel?: number | null
  costPerKm?: number | null
  /** Triage outcome: AUTO | REVIEW | FLAGGED. */
  badges?: "AUTO" | "REVIEW" | "FLAGGED" | null
  /** Odometer photo (the receipt photo reuses `receipt_uri`). */
  odometer_uri?: string | null
}

/** OCR below this is surfaced as a low-confidence banner. Shared so the rule cannot drift (A1.4). */
const LOW_CONFIDENCE = OCR_CONFIDENCE_THRESHOLD

/** Fields compared across the OCR / Driver / Admin columns. */
const COMPARE_FIELDS: { key: string; labelKey: string }[] = [
  { key: "amount", labelKey: "admin.fuel.cost" },
  { key: "liters", labelKey: "admin.fuel.litres" },
  { key: "odometer", labelKey: "admin.purchaseDetail.odometer" },
  { key: "station", labelKey: "admin.purchaseDetail.station" },
  { key: "date", labelKey: "admin.purchaseDetail.purchaseDate" },
]

/** Renders an arbitrary OCR/driver value as display text. */
function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return t("common.notAvailable")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Admin override draft — all fields optional, blank means "leave as-is". */
interface OverrideDraft {
  amount: string
  liters: string
  odometer: string
  notes: string
}

const EMPTY_DRAFT: OverrideDraft = { amount: "", liters: "", odometer: "", notes: "" }

export interface PurchaseDetailScreenProps {
  services: Services
  /** Purchase selected in `FuelReconcileScreen`. */
  id?: string
  onBack: () => void
  /** Optional overrides — the screen fetches its own data when these are omitted. */
  purchase?: PurchaseDetail
  canVerify?: boolean
  canClearPayment?: boolean
  onVerify?: () => void
  onReject?: (reason: string) => void
  onClearPayment?: () => void
}

const severityTone = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
} as const

function toneFor(severity?: string | null): "neutral" | "info" | "warning" | "danger" {
  if (severity && severity in severityTone) return severityTone[severity as keyof typeof severityTone]
  return "neutral"
}

/** Maps the reused `FuelReconcileRow` (detail payload == inbox row) onto this screen's view shape. */
function toView(row: FuelReconcileRow): PurchaseDetail {
  const openAnomalies = Number(row.open_anomalies ?? 0)
  return {
    fuel_purchase_id: row.fuel_purchase_id,
    purchased_at: row.purchased_at ?? null,
    driver_name: row.driver_name ?? null,
    vehicle_plate: row.vehicle_plate ?? null,
    vehicle_id: row.vehicle_id ?? null,
    litres: row.litres ?? null,
    total_cost: row.total_cost ?? null,
    currency: row.currency ?? null,
    odometer_km: row.odometer_km ?? null,
    gauge_before_percent: row.gauge_before_percent ?? null,
    gauge_after_percent: row.gauge_after_percent ?? null,
    admin_verified: row.admin_verified ?? null,
    payment_method: row.fuel_card_last_four ? `•••• ${row.fuel_card_last_four}` : null,
    status: row.rejected_at ? "REJECTED" : row.admin_verified ? "VERIFIED" : "PENDING",
    anomalies:
      openAnomalies > 0
        ? [{ anomaly_id: row.fuel_purchase_id, severity: row.worst_open_severity ?? null, label: row.worst_open_severity ?? null }]
        : [],
  }
}

/**
 * Maps a photo-first pending row (`GET /admin/fuel/pending`) onto the view shape. This payload is
 * richer than the statement inbox row: it carries the OCR bag, the driver's corrections, the two
 * evidence photos and the derived economics, so it is preferred when both are available.
 */
function pendingToView(row: FuelPendingRow, mediaUri: (id?: string | null) => string | null): PurchaseDetail {
  const flagged = row.badge === "FLAGGED"
  return {
    fuel_purchase_id: row.fuel_purchase_id,
    purchased_at: row.receipt_date ?? null,
    vehicle_plate: row.vehicle_plate ?? null,
    station_name: row.station_name ?? null,
    litres: row.liters_pumped,
    total_cost: row.amount_spent,
    currency: "KES",
    odometer_km: row.odometer_km,
    admin_verified: false,
    status: "PENDING",
    ocrRawData: row.ocr_raw_data ?? null,
    driverCorrected: row.driver_corrected ?? false,
    confidenceScore: row.confidence_score,
    distanceSinceLastRefuel: row.distance_since_last_refuel,
    costPerKm: row.cost_per_km,
    badges: row.badge,
    receipt_uri: mediaUri(row.receipt_media_object_id),
    odometer_uri: mediaUri(row.odometer_photo_media_object_id),
    anomalies: flagged
      ? [{ anomaly_id: row.fuel_purchase_id, severity: "HIGH", label: t("admin.fuel.badgeFlagged") }]
      : [],
  }
}

export function PurchaseDetailScreen({
  services,
  id,
  onBack,
  purchase: purchaseProp,
  canVerify = true,
  canClearPayment = true,
  onVerify,
  onReject,
  onClearPayment,
}: PurchaseDetailScreenProps) {
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<PurchaseDetail | null>(null)
  const [correcting, setCorrecting] = useState(false)
  const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT)
  const [zoomUri, setZoomUri] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    // The photo-first queue is the richer payload — prefer it when the purchase is in review.
    const pendingRow: FuelPendingRow | undefined = services.admin.fuel.getPending(id)
    if (pendingRow) {
      setFetched(pendingToView(pendingRow, (m) => services.admin.fuel.mediaUri(m)))
      setLoading(false)
      return
    }
    const row = await services.admin.fuel.getOne(id)
    setFetched(row ? toView(row) : null)
    setLoading(false)
  }, [services, id])

  // Load both inboxes so `refresh` can resolve from either, then subscribe to verify/reject writes.
  useEffect(() => {
    void services.admin.fuel.loadPending().catch(() => undefined)
    void services.admin.fuel.load().then(refresh)
    const off = services.admin.fuel.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const purchase = purchaseProp ?? fetched
  const anomalies = purchase?.anomalies ?? []
  const verified = purchase?.admin_verified === true
  const currency = purchase?.currency ?? ""
  const isPhotoFirst = purchase?.ocrRawData != null || purchase?.driverCorrected != null || purchase?.badges != null
  const confidence = purchase?.confidenceScore ?? null
  const lowConfidence = confidence != null && confidence < LOW_CONFIDENCE
  const flagged = purchase?.badges === "FLAGGED"

  /** Numeric parse that treats blank/invalid as "no override". */
  const numOr = (v: string): number | undefined => {
    if (!v.trim()) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  const verify = async () => {
    setBusy(true)
    try {
      if (onVerify) onVerify()
      else if (id) await services.admin.fuel.verify(id, { action: "VERIFY" })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /** Approve with admin corrections — `PUT /admin/fuel/verify/{id}` with the adjusted_* fields. */
  const applyCorrection = async () => {
    if (!id) return
    setBusy(true)
    try {
      await services.admin.fuel.verify(
        id,
        { action: "VERIFY" },
        {
          ...(numOr(draft.amount) !== undefined ? { adjusted_amount: numOr(draft.amount) } : {}),
          ...(numOr(draft.liters) !== undefined ? { adjusted_liters: numOr(draft.liters) } : {}),
          ...(numOr(draft.odometer) !== undefined ? { adjusted_odometer: numOr(draft.odometer) } : {}),
          ...(draft.notes.trim() ? { admin_notes: draft.notes.trim() } : {}),
        },
      )
      setCorrecting(false)
      setDraft(EMPTY_DRAFT)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!rejectReason) return
    setBusy(true)
    try {
      if (onReject) onReject(rejectReason)
      else if (id) await services.admin.fuel.verify(id, { action: "REJECT", rejection_reason: rejectReason })
      setRejecting(false)
      setRejectReason("")
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const clearPayment = async () => {
    setBusy(true)
    try {
      if (onClearPayment) onClearPayment()
      else if (id) await services.admin.fuel.verify(id, { action: "CLEAR_PAYMENT" })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  if (loading || !purchase) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-purchase-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.purchaseDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.fuel.inboxEmpty")}
          description={loading ? undefined : t("admin.fuel.inboxEmptyDescription")}
          icon={<Icon name="local_gas_station" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-purchase-detail">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.purchaseDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* Header summary */}
      <Card variant="container" accent={anomalies.length > 0 ? theme.colors.supportError : theme.colors.supportSuccess}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
          <Icon name="local_gas_station" size={24} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle">
              {currency ? `${currency} ${purchase.total_cost ?? "—"}` : String(purchase.total_cost ?? "—")}
            </Text>
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {t("admin.purchaseDetail.purchasedAt", { at: purchase.purchased_at ?? t("common.notAvailable") })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          <StatusBadge
            label={verified ? t("admin.purchaseDetail.adminVerified") : t("admin.purchaseDetail.unverified")}
            tone={verified ? "success" : "warning"}
          />
          {purchase.payment_cleared ? <StatusBadge label={t("admin.purchaseDetail.paymentCleared")} tone="success" /> : null}
          {anomalies.length > 0 ? (
            <StatusBadge label={t("admin.purchaseDetail.anomalyCount", { count: anomalies.length })} tone="danger" />
          ) : null}
        </View>
      </Card>

      {/* Purchase data */}
      <Card variant="container" title={t("admin.purchaseDetail.purchaseData")}>
        <DataTable<{ label: string; value: string }>
          testID="purchase-data-table"
          columns={[
            {
              key: "label",
              header: t("admin.purchaseDetail.field"),
              flex: 1,
              render: (r) => (
                <Text preset="label" color={theme.colors.onSurfaceVariant}>
                  {r.label}
                </Text>
              ),
            },
            {
              key: "value",
              header: t("admin.purchaseDetail.value"),
              flex: 1,
              align: "right",
              render: (r) => <Text preset="body02">{r.value}</Text>,
            },
          ]}
          rows={[
            { label: t("admin.purchaseDetail.station"), value: purchase.station_name ?? t("common.notAvailable") },
            { label: t("admin.purchaseDetail.location"), value: purchase.location_text ?? t("common.notAvailable") },
            { label: t("admin.purchaseDetail.driver"), value: purchase.driver_name ?? purchase.driver_id ?? t("common.notAvailable") },
            { label: t("admin.purchaseDetail.vehicle"), value: purchase.vehicle_plate ?? purchase.vehicle_id ?? t("common.notAvailable") },
            { label: t("admin.purchaseDetail.fuelType"), value: purchase.fuel_type ?? t("common.notAvailable") },
            {
              label: t("admin.purchaseDetail.litres"),
              value: purchase.litres != null ? `${purchase.litres} ${t("common.litres")}` : t("common.notAvailable"),
            },
            {
              label: t("admin.fuel.adjustedLitres"),
              value: purchase.adjusted_litres != null ? `${purchase.adjusted_litres} ${t("common.litres")}` : t("common.notAvailable"),
            },
            {
              label: t("admin.purchaseDetail.unitPrice"),
              value: purchase.unit_price != null ? `${currency} ${purchase.unit_price}` : t("common.notAvailable"),
            },
            {
              label: t("admin.purchaseDetail.totalCost"),
              value: purchase.total_cost != null ? `${currency} ${purchase.total_cost}` : t("common.notAvailable"),
            },
            { label: t("admin.purchaseDetail.paymentMethod"), value: purchase.payment_method ?? t("common.notAvailable") },
            {
              label: t("admin.purchaseDetail.odometer"),
              value: purchase.odometer_km != null ? `${purchase.odometer_km} ${t("common.km")}` : t("common.notAvailable"),
            },
          ]}
        />
      </Card>

      {/* Low-confidence / flagged banner (photo-first review) */}
      {isPhotoFirst && (lowConfidence || flagged) ? (
        <Card variant="surface" accent={theme.colors.supportError} testID="purchase-anomaly-banner">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <Icon name="warning" size={20} color={theme.colors.supportError} />
            <Text preset="body02" style={{ flex: 1 }}>
              {flagged
                ? t("admin.fuel.anomalyBanner", { count: 1 })
                : t("admin.fuel.lowConfidence", { score: Math.round((confidence ?? 0) * 100) })}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Photo evidence (receipt + odometer), tap to zoom */}
      {isPhotoFirst ? (
        <Card variant="container" title={t("admin.purchaseDetail.photoEvidence")}>
          <View style={{ flexDirection: "row", gap: theme.spacing[3], flexWrap: "wrap" }}>
            <EvidenceTile
              label={t("admin.purchaseDetail.receipt")}
              uri={purchase.receipt_uri}
              onPress={purchase.receipt_uri ? () => setZoomUri(purchase.receipt_uri ?? null) : undefined}
              testID="purchase-receipt-photo"
            />
            <EvidenceTile
              label={t("admin.purchaseDetail.odometer")}
              uri={purchase.odometer_uri}
              onPress={purchase.odometer_uri ? () => setZoomUri(purchase.odometer_uri ?? null) : undefined}
              testID="purchase-odometer-photo"
            />
          </View>
          <View style={{ flexDirection: "row", gap: theme.spacing[5], marginTop: theme.spacing[4], flexWrap: "wrap" }}>
            <View>
              <Text preset="label" color={theme.colors.onSurfaceVariant}>
                {t("admin.fuel.distanceSinceLastRefuel")}
              </Text>
              <Text preset="body02">
                {purchase.distanceSinceLastRefuel != null
                  ? `${purchase.distanceSinceLastRefuel} ${t("common.km")}`
                  : t("common.notAvailable")}
              </Text>
            </View>
            <View>
              <Text preset="label" color={theme.colors.onSurfaceVariant}>
                {t("admin.fuel.costPerKm")}
              </Text>
              <Text preset="body02">
                {purchase.costPerKm != null ? `${currency} ${purchase.costPerKm}` : t("common.notAvailable")}
              </Text>
            </View>
            {confidence != null ? (
              <View>
                <Text preset="label" color={theme.colors.onSurfaceVariant}>
                  {t("admin.fuel.confidence")}
                </Text>
                <Text preset="body02">{`${Math.round(confidence * 100)}${t("common.percent")}`}</Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {/* OCR vs Driver vs Admin */}
      {isPhotoFirst ? (
        <Card variant="container" title={t("admin.fuel.ocrData")}>
          <DataTable<{ label: string; ocr: string; driver: string; admin: string }>
            testID="purchase-ocr-table"
            columns={[
              {
                key: "label",
                header: t("admin.purchaseDetail.field"),
                flex: 1.2,
                render: (r) => (
                  <Text preset="label" color={theme.colors.onSurfaceVariant}>
                    {r.label}
                  </Text>
                ),
              },
              { key: "ocr", header: t("admin.fuel.ocrData"), flex: 1, render: (r) => <Text preset="body02">{r.ocr}</Text> },
              { key: "driver", header: t("admin.fuel.driverValue"), flex: 1, render: (r) => <Text preset="body02">{r.driver}</Text> },
              {
                key: "admin",
                header: t("admin.fuel.adminOverride"),
                flex: 1,
                align: "right",
                render: (r) => <Text preset="body02">{r.admin}</Text>,
              },
            ]}
            rows={COMPARE_FIELDS.map((f) => ({
              label: t(f.labelKey),
              ocr: cell(purchase.ocrRawData?.[f.key]),
              // `driver_corrected` is a flag, not a value bag: once set, the settled columns on the
              // purchase already carry what the driver keyed, so that is what we show.
              driver: purchase.driverCorrected
                ? cell(
                    f.key === "amount"
                      ? purchase.total_cost
                      : f.key === "liters"
                        ? purchase.litres
                        : f.key === "odometer"
                          ? purchase.odometer_km
                          : undefined,
                  )
                : cell(undefined),
              admin: cell(
                f.key === "amount"
                  ? draft.amount || undefined
                  : f.key === "liters"
                    ? draft.liters || undefined
                    : f.key === "odometer"
                      ? draft.odometer || undefined
                      : undefined,
              ),
            }))}
          />
        </Card>
      ) : null}

      {/* Gauge evidence */}
      <Card variant="container" title={t("admin.fuel.gaugeEvidence")}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
          <Icon name="gas_meter" size={24} color={theme.colors.onSurfaceVariant} />
          <Text preset="body02" style={{ flex: 1 }}>
            {t("admin.purchaseDetail.gaugeRange", {
              before: purchase.gauge_before_percent ?? "—",
              after: purchase.gauge_after_percent ?? "—",
            })}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          <StatusBadge
            label={`${t("admin.fuel.expectedRise")}: ${purchase.expected_rise_percent ?? "—"}${t("common.percent")}`}
            tone="neutral"
          />
          <StatusBadge
            label={`${t("admin.fuel.actualRise")}: ${purchase.actual_rise_percent ?? "—"}${t("common.percent")}`}
            tone="neutral"
          />
          <StatusBadge
            label={`${t("admin.fuel.deviation")}: ${purchase.deviation_percent ?? "—"}${t("common.percent")}`}
            tone={(purchase.deviation_percent ?? 0) > 10 ? "danger" : "success"}
          />
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[4], flexWrap: "wrap" }}>
          <EvidenceTile label={t("admin.purchaseDetail.gaugeBefore")} uri={purchase.gauge_before_uri} />
          <EvidenceTile label={t("admin.purchaseDetail.gaugeAfter")} uri={purchase.gauge_after_uri} />
          <EvidenceTile label={t("admin.purchaseDetail.receipt")} uri={purchase.receipt_uri} />
        </View>
      </Card>

      {/* Anomalies */}
      <Card variant="container" title={t("admin.purchaseDetail.anomalies")}>
        {anomalies.length === 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <Icon name="check_circle" size={20} color={theme.colors.success} />
            <Text preset="body02" color={theme.colors.onSurfaceVariant}>
              {t("admin.purchaseDetail.noAnomalies")}
            </Text>
          </View>
        ) : (
          anomalies.map((a, i) => (
            <Card
              key={a.anomaly_id ?? a.code ?? i}
              variant="surface"
              accent={a.severity === "CRITICAL" || a.severity === "HIGH" ? theme.colors.supportError : theme.colors.supportWarning}
              style={{ marginBottom: theme.spacing[3] }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing[3] }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flex: 1 }}>
                  <Icon name="warning" size={20} color={theme.colors.error} />
                  <Text preset="bodyStrong" style={{ flex: 1 }}>
                    {a.label ?? a.code ?? t("common.notAvailable")}
                  </Text>
                </View>
                {a.severity ? <StatusBadge label={a.severity} tone={toneFor(a.severity)} /> : null}
              </View>
              {a.detail ? (
                <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[3] }}>
                  {a.detail}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </Card>

      {/* Actions (permission gated) */}
      <Card variant="container" title={t("admin.purchaseDetail.actions")}>
        {purchase.rejection_reason ? (
          <Text preset="body02" color={theme.colors.error} style={{ marginBottom: theme.spacing[3] }}>
            {purchase.rejection_reason}
          </Text>
        ) : null}
        {verified && purchase.verified_by ? (
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[3] }}>
            {t("admin.purchaseDetail.verifiedBy", {
              user: purchase.verified_by,
              at: purchase.verified_at ?? t("common.notAvailable"),
            })}
          </Text>
        ) : null}

        {rejecting ? (
          <View>
            <Input
              label={isPhotoFirst ? t("admin.fuel.flagReason") : t("admin.fuel.rejectReason")}
              value={rejectReason}
              onChangeText={setRejectReason}
              required
              multiline
              testID="purchase-reject-reason"
            />
            <View style={{ gap: theme.spacing[3] }}>
              <Button variant="danger" loading={busy} disabled={!rejectReason} onPress={() => void reject()} testID="purchase-reject-submit">
                {isPhotoFirst ? t("admin.fuel.flag") : t("admin.fuel.reject")}
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setRejecting(false)
                  setRejectReason("")
                }}
              >
                {t("common.cancel")}
              </Button>
            </View>
          </View>
        ) : (
          <View style={{ gap: theme.spacing[3] }}>
            {canVerify ? (
              <>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={verified}
                  onPress={() => void verify()}
                  icon={<Icon name="check_circle" size={20} color={theme.colors.onPrimary} />}
                  testID="purchase-verify"
                >
                  {isPhotoFirst ? t("admin.fuel.approve") : t("admin.fuel.verify")}
                </Button>
                {isPhotoFirst ? (
                  <Button
                    variant="secondary"
                    disabled={verified}
                    onPress={() => setCorrecting(true)}
                    testID="purchase-correct"
                  >
                    {t("admin.fuel.correct")}
                  </Button>
                ) : null}
                <Button variant="secondary" onPress={() => setRejecting(true)} testID="purchase-reject">
                  {isPhotoFirst ? t("admin.fuel.flag") : t("admin.fuel.reject")}
                </Button>
              </>
            ) : (
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t("admin.purchaseDetail.noVerifyPermission")}
              </Text>
            )}
            {canClearPayment ? (
              <>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={!verified || purchase.payment_cleared === true}
                  onPress={() => void clearPayment()}
                  icon={<Icon name="gavel" size={20} color={theme.colors.primary} />}
                  testID="purchase-clear-payment"
                >
                  {t("admin.fuel.clearPayment")}
                </Button>
                {!verified ? (
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {t("admin.purchaseDetail.clearRequiresVerified")}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        )}
      </Card>

      {/* Admin override modal — blank fields are left untouched by the server. */}
      <BottomSheet open={correcting} onClose={() => setCorrecting(false)} title={t("admin.fuel.adminOverride")} centered>
        <Input
          label={t("admin.fuel.overrideAmount")}
          value={draft.amount}
          onChangeText={(v) => setDraft({ ...draft, amount: v })}
          keyboardType="decimal-pad"
          placeholder={purchase.total_cost != null ? String(purchase.total_cost) : undefined}
          testID="purchase-override-amount"
        />
        <Input
          label={t("admin.fuel.overrideLiters")}
          value={draft.liters}
          onChangeText={(v) => setDraft({ ...draft, liters: v })}
          keyboardType="decimal-pad"
          placeholder={purchase.litres != null ? String(purchase.litres) : undefined}
          testID="purchase-override-liters"
        />
        <Input
          label={t("admin.fuel.overrideOdometer")}
          value={draft.odometer}
          onChangeText={(v) => setDraft({ ...draft, odometer: v })}
          keyboardType="number-pad"
          placeholder={purchase.odometer_km != null ? String(purchase.odometer_km) : undefined}
          testID="purchase-override-odometer"
        />
        <Input
          label={t("admin.fuel.adminNotes")}
          value={draft.notes}
          onChangeText={(v) => setDraft({ ...draft, notes: v })}
          multiline
          testID="purchase-override-notes"
        />
        <View style={{ gap: theme.spacing[3] }}>
          <Button variant="primary" loading={busy} onPress={() => void applyCorrection()} testID="purchase-override-submit">
            {t("admin.fuel.applyCorrection")}
          </Button>
          <Button variant="ghost" onPress={() => setCorrecting(false)}>
            {t("common.cancel")}
          </Button>
        </View>
      </BottomSheet>

      {/* Full-screen photo zoom. */}
      <Modal visible={!!zoomUri} transparent animationType="fade" onRequestClose={() => setZoomUri(null)}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          activeOpacity={1}
          onPress={() => setZoomUri(null)}
          style={{ flex: 1, backgroundColor: theme.colors.scrim, alignItems: "center", justifyContent: "center" }}
          testID="purchase-photo-zoom"
        >
          {zoomUri ? <Image source={{ uri: zoomUri }} style={{ width: "100%", height: "80%" }} resizeMode="contain" /> : null}
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  )
}

function EvidenceTile({
  label,
  uri,
  onPress,
  testID,
}: {
  label: string
  uri?: string | null
  onPress?: () => void
  testID?: string
}) {
  const tile = (
    <View
      style={{
        width: 104,
        height: 104,
        backgroundColor: theme.colors.surfaceContainerHigh,
        borderWidth: 1,
        borderColor: theme.colors.outlineVariant,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      ) : (
        <Icon name="zoom_in" size={24} color={theme.colors.outline} />
      )}
    </View>
  )
  return (
    <View style={{ width: 104 }}>
      {onPress ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}>
          {tile}
        </TouchableOpacity>
      ) : (
        <View testID={testID}>{tile}</View>
      )}
      <Text preset="label" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
        {label}
      </Text>
    </View>
  )
}
