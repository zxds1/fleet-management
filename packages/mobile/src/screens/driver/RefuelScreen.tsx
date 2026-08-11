// packages/mobile/src/screens/driver/RefuelScreen.tsx
//
// Photo-first refuel (spec B3). The driver never types a price, a litre count or a station name:
// they snap the receipt, snap the odometer, key in the odometer reading (the single value a camera
// cannot reliably supply on its own) and confirm what the OCR read back.
//
// OCR runs asynchronously in a worker, so the purchase must be created BEFORE its parsed values
// exist. The flow therefore submits at the end of `enter_odometer`, shows `awaiting_ocr` while the
// router polls, and only then renders the review step. Edits made there are posted as corrections
// against the purchase that already exists, which is exactly what `POST /driver/fuel/correct`
// expects.
//
// Steps: capture_receipt → capture_odometer → enter_odometer → awaiting_ocr → review → success.

import React, { useMemo, useState } from "react"
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { PhotoCapture, type CapturedPhoto } from "@/design/components/PhotoCapture"
import { ErrorState } from "@/design/components/ErrorState"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import { OCR_CONFIDENCE_THRESHOLD } from "@fleet/shared/mobile"
import type { AppError } from "@/core/error"

/** Receipt values read by the backend OCR. Every field is optional — a poor scan yields few. */
export interface RefuelOcrPreview {
  amount?: string
  liters?: number
  date?: string
  station?: string
  /** 0–1, matching `app.fuel_purchases.ocr_confidence`. Compared to OCR_CONFIDENCE_THRESHOLD. */
  confidence?: number
}

/** Driver overrides for the OCR'd fields; only the keys they actually edited are present. */
export interface RefuelCorrections {
  amount?: string
  liters?: number
  date?: string
  station?: string
}

export interface RefuelSubmitPayload {
  odometer_reading: number
  receipt: CapturedPhoto
  odometerPhoto: CapturedPhoto
  fuel_card_last_four?: string
}

export interface RefuelScreenProps {
  vehicleId: string
  shiftId: string | null
  submitting: boolean
  error?: AppError
  /** Last odometer recorded for this vehicle; the new reading must exceed it. */
  lastOdometer?: number
  /** OCR preview, populated by the router once polling resolves. */
  ocr?: RefuelOcrPreview
  /**
   * Router-driven flow position: `submitting` while the purchase POST is in flight, `awaiting_ocr`
   * while polling, `review` once OCR settled (or gave up), `done` after corrections are saved.
   */
  phase?: "capture" | "awaiting_ocr" | "review" | "done"
  /** Purchase created by the submit step; corrections are posted against it. */
  onSubmit: (payload: RefuelSubmitPayload) => void
  /** Confirm the review step, posting any driver edits as corrections. */
  onConfirm: (corrections?: RefuelCorrections) => void
  onCancel: () => void
}

type Step = "capture_receipt" | "capture_odometer" | "enter_odometer" | "awaiting_ocr" | "review" | "success"

type EditableField = keyof RefuelCorrections

export function RefuelScreen({
  vehicleId,
  shiftId,
  submitting,
  error,
  lastOdometer,
  ocr,
  phase = "capture",
  onSubmit,
  onConfirm,
  onCancel,
}: RefuelScreenProps) {
  const [step, setStep] = useState<Step>("capture_receipt")
  const [receipt, setReceipt] = useState<CapturedPhoto | null>(null)
  const [odometerPhoto, setOdometerPhoto] = useState<CapturedPhoto | null>(null)
  const [odometer, setOdometer] = useState("")
  const [corrections, setCorrections] = useState<RefuelCorrections>({})
  const [editing, setEditing] = useState<EditableField | null>(null)
  const [draft, setDraft] = useState("")

  const odometerValue = Number(odometer)
  const odometerValid =
    odometer.trim().length > 0 &&
    Number.isFinite(odometerValue) &&
    Number.isInteger(odometerValue) &&
    odometerValue >= 0 &&
    (lastOdometer === undefined || odometerValue > lastOdometer)

  const odometerError =
    odometer.trim().length > 0 && !odometerValid && lastOdometer !== undefined
      ? t("driver.refuel.prevOdometerError", { value: lastOdometer })
      : undefined

  const lowConfidence = ocr?.confidence !== undefined && ocr.confidence < OCR_CONFIDENCE_THRESHOLD

  /** OCR value overlaid with any driver correction; `undefined` renders an em dash. */
  const shown = useMemo(
    () => ({
      amount: corrections.amount ?? ocr?.amount,
      liters: corrections.liters ?? ocr?.liters,
      date: corrections.date ?? ocr?.date,
      station: corrections.station ?? ocr?.station,
    }),
    [corrections, ocr],
  )

  const openEditor = (field: EditableField) => {
    const current = shown[field]
    setDraft(current === undefined || current === null ? "" : String(current))
    setEditing(field)
  }

  const commitEdit = () => {
    if (!editing) return
    const value = draft.trim()
    setCorrections((prev) => {
      const next = { ...prev }
      if (!value) {
        delete next[editing]
        return next
      }
      if (editing === "liters") {
        const n = Number(value)
        if (Number.isFinite(n) && n > 0) next.liters = n
        return next
      }
      next[editing] = value
      return next
    })
    setEditing(null)
    setDraft("")
  }

  /** End of step 4: create the purchase. OCR (and therefore the review step) follows. */
  const submit = () => {
    if (!receipt || !odometerPhoto || !odometerValid) return
    onSubmit({ odometer_reading: odometerValue, receipt, odometerPhoto })
  }

  /** End of step 6: accept the reviewed values, posting any edits as corrections. */
  const confirm = () => {
    const hasCorrections = Object.keys(corrections).length > 0
    onConfirm(hasCorrections ? corrections : undefined)
  }

  const container = { padding: theme.spacing[5], paddingBottom: theme.spacing[7] }

  // The router owns everything after the capture steps: it knows when the purchase committed, when
  // OCR polling resolved, and when the corrections were saved. Local `step` only drives capture.
  const current: Step =
    phase === "done" ? "success" : phase === "review" ? "review" : phase === "awaiting_ocr" ? "awaiting_ocr" : step

  // ---- Step 8: success -------------------------------------------------------------------
  if (current === "success") {
    return (
      <ScrollView contentContainerStyle={container} testID="refuel-success">
        <View style={{ alignItems: "center", marginTop: theme.spacing[6] }}>
          <Icon name="check_circle" size={64} color={theme.colors.supportSuccess} />
          <Text preset="heading03" align="center" style={{ marginTop: theme.spacing[4] }}>
            {t("driver.refuel.savedToast")}
          </Text>
        </View>
        <View style={{ marginTop: theme.spacing[6] }}>
          <Button onPress={onCancel} testID="refuel-return-dashboard">
            {t("driver.refuel.returnDashboard")}
          </Button>
        </View>
      </ScrollView>
    )
  }

  // ---- Step 2: receipt photo -------------------------------------------------------------
  if (current === "capture_receipt") {
    return (
      <ScrollView contentContainerStyle={container} testID="refuel-screen">
        <Text preset="heading03">{t("driver.refuel.refuelTitle")}</Text>
        <Text preset="body01" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
          {t("driver.refuel.snapReceipt")}
        </Text>
        <Card style={{ marginTop: theme.spacing[4] }}>
          <PhotoCapture
            label={t("driver.refuel.snapReceipt")}
            required
            value={receipt}
            onCapture={setReceipt}
            testID="refuel-receipt-capture"
          />
        </Card>
        {error && <ErrorState error={error} />}
        <View style={{ marginTop: theme.spacing[5] }}>
          <Button disabled={!receipt} onPress={() => setStep("capture_odometer")} testID="refuel-receipt-continue">
            {t("driver.refuel.continue")}
          </Button>
          <View style={{ marginTop: theme.spacing[3] }}>
            <Button variant="ghost" onPress={onCancel}>
              {t("driver.refuel.cancel")}
            </Button>
          </View>
        </View>
      </ScrollView>
    )
  }

  // ---- Step 3: odometer photo ------------------------------------------------------------
  if (current === "capture_odometer") {
    return (
      <ScrollView contentContainerStyle={container} testID="refuel-screen">
        <Text preset="heading03">{t("driver.refuel.refuelTitle")}</Text>
        <Text preset="body01" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
          {t("driver.refuel.snapOdometer")}
        </Text>
        <Card style={{ marginTop: theme.spacing[4] }}>
          <PhotoCapture
            label={t("driver.refuel.snapOdometer")}
            required
            value={odometerPhoto}
            onCapture={setOdometerPhoto}
            testID="refuel-odometer-capture"
          />
        </Card>
        {error && <ErrorState error={error} />}
        <View style={{ marginTop: theme.spacing[5] }}>
          <Button
            disabled={!odometerPhoto}
            onPress={() => setStep("enter_odometer")}
            testID="refuel-odometer-continue"
          >
            {t("driver.refuel.continue")}
          </Button>
          <View style={{ marginTop: theme.spacing[3] }}>
            <Button variant="ghost" onPress={() => setStep("capture_receipt")}>
              {t("common.back")}
            </Button>
          </View>
        </View>
      </ScrollView>
    )
  }

  // ---- Step 4: odometer reading (the only typed field) -----------------------------------
  if (current === "enter_odometer") {
    return (
      <ScrollView contentContainerStyle={container} testID="refuel-screen">
        <Text preset="heading03">{t("driver.refuel.odometerReading")}</Text>

        {/* Both captures, side by side, so the driver can confirm before keying the reading. */}
        <View style={{ flexDirection: "row", gap: theme.spacing[4], marginTop: theme.spacing[4] }}>
          <View style={{ flex: 1 }} testID="refuel-thumb-receipt">
            <Thumbnail label={t("driver.refuel.snapReceipt")} photo={receipt} />
          </View>
          <View style={{ flex: 1 }} testID="refuel-thumb-odometer">
            <Thumbnail label={t("driver.refuel.snapOdometer")} photo={odometerPhoto} />
          </View>
        </View>

        <View style={{ marginTop: theme.spacing[5] }}>
          <Input
            label={t("driver.refuel.odometerReading")}
            required
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            error={odometerError}
            helperText={t("driver.refuel.odometerHint")}
            testID="refuel-odometer-input"
          />
        </View>

        {error && <ErrorState error={error} />}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button loading={submitting} disabled={!odometerValid} onPress={submit} testID="refuel-odometer-submit">
            {t("driver.refuel.continue")}
          </Button>
          <View style={{ marginTop: theme.spacing[3] }}>
            <Button variant="ghost" onPress={() => setStep("capture_odometer")}>
              {t("common.back")}
            </Button>
          </View>
        </View>
      </ScrollView>
    )
  }

  // ---- Between steps 4 and 5: the worker is still reading the receipt --------------------
  if (current === "awaiting_ocr") {
    return (
      <ScrollView contentContainerStyle={container} testID="refuel-awaiting-ocr">
        <View style={{ alignItems: "center", marginTop: theme.spacing[6] }}>
          <ActivityIndicator color={theme.colors.interactive01} size="large" />
          <Text preset="heading03" align="center" style={{ marginTop: theme.spacing[4] }}>
            {t("driver.refuel.readingReceipt")}
          </Text>
          <Text
            preset="body01"
            align="center"
            color={theme.colors.textSecondary}
            style={{ marginTop: theme.spacing[2] }}
          >
            {t("driver.refuel.readingReceiptHint")}
          </Text>
        </View>
      </ScrollView>
    )
  }

  // ---- Steps 5–7: review the OCR result, edit inline, confirm ----------------------------
  return (
    <ScrollView contentContainerStyle={container} testID="refuel-review">
      <Text preset="heading03">{t("driver.refuel.reviewTitle")}</Text>

      {lowConfidence && (
        <View
          testID="refuel-low-confidence"
          style={{
            marginTop: theme.spacing[4],
            padding: theme.spacing[4],
            borderLeftWidth: 4,
            borderLeftColor: theme.colors.supportWarning,
            backgroundColor: theme.colors.supportWarningLight,
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing[3],
          }}
        >
          <Icon name="warning" size={20} color={theme.colors.supportWarningInverse} />
          <Text preset="body01" style={{ flex: 1 }} color={theme.colors.textPrimary}>
            {t("driver.refuel.lowConfidenceWarning")}
          </Text>
        </View>
      )}

      <Card style={{ marginTop: theme.spacing[4] }}>
        <ReviewRow
          label={t("driver.refuel.amountSpent")}
          value={shown.amount}
          editing={editing === "amount"}
          draft={draft}
          onDraftChange={setDraft}
          onEdit={() => openEditor("amount")}
          onCommit={commitEdit}
          onDismiss={() => setEditing(null)}
          keyboardType="decimal-pad"
          testID="refuel-field-amount"
        />
        <ReviewRow
          label={t("driver.refuel.litersPumped")}
          value={shown.liters}
          editing={editing === "liters"}
          draft={draft}
          onDraftChange={setDraft}
          onEdit={() => openEditor("liters")}
          onCommit={commitEdit}
          onDismiss={() => setEditing(null)}
          keyboardType="decimal-pad"
          testID="refuel-field-liters"
        />
        <ReviewRow
          label={t("driver.refuel.receiptDate")}
          value={shown.date}
          editing={editing === "date"}
          draft={draft}
          onDraftChange={setDraft}
          onEdit={() => openEditor("date")}
          onCommit={commitEdit}
          onDismiss={() => setEditing(null)}
          testID="refuel-field-date"
        />
        <ReviewRow
          label={t("driver.refuel.stationName")}
          value={shown.station}
          editing={editing === "station"}
          draft={draft}
          onDraftChange={setDraft}
          onEdit={() => openEditor("station")}
          onCommit={commitEdit}
          onDismiss={() => setEditing(null)}
          testID="refuel-field-station"
        />
        {/* The odometer is already committed with the purchase, so it is shown for confirmation
            only; changing it here would need a correction round-trip the spec does not ask for. */}
        <ReviewRow
          label={t("driver.refuel.odometerReading")}
          value={odometerValue}
          readOnly
          testID="refuel-field-odometer"
        />
      </Card>

      <Text preset="body01" color={theme.colors.textSecondary}>
        {t("driver.refuel.looksCorrect")}
      </Text>

      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button loading={submitting} onPress={confirm} testID="refuel-submit">
          {t("driver.refuel.confirmSave")}
        </Button>
      </View>
    </ScrollView>
  )
}

/** Captured-photo placeholder. The bitmap itself is drawn by the native layer (see PhotoCapture). */
function Thumbnail({ label, photo }: { label: string; photo: CapturedPhoto | null }) {
  return (
    <View>
      <Text preset="label01" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View
        style={{
          height: 96,
          marginTop: theme.spacing[2],
          backgroundColor: theme.colors.ui02,
          borderWidth: 1,
          borderColor: theme.colors.ui03,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={photo ? "check_circle" : "photo_camera"}
          size={24}
          color={photo ? theme.colors.supportSuccess : theme.colors.textSecondary}
        />
      </View>
    </View>
  )
}

interface ReviewRowProps {
  label: string
  value?: string | number
  editing?: boolean
  draft?: string
  onDraftChange?: (v: string) => void
  onEdit?: () => void
  onCommit?: () => void
  onDismiss?: () => void
  /** Renders the value without an edit pencil (fields already committed with the purchase). */
  readOnly?: boolean
  keyboardType?: "default" | "decimal-pad"
  testID: string
}

/**
 * One read-only OCR field with an edit pencil. Tapping the pencil swaps the value for an inline
 * text field (step 7) rather than pushing a modal screen, keeping the driver on the review page.
 */
function ReviewRow({
  label,
  value,
  editing = false,
  draft = "",
  onDraftChange,
  onEdit,
  onCommit,
  onDismiss,
  readOnly = false,
  keyboardType = "default",
  testID,
}: ReviewRowProps) {
  if (editing && onDraftChange && onCommit) {
    return (
      <View testID={`${testID}-edit`} style={{ paddingVertical: theme.spacing[2] }}>
        <Input
          label={label}
          value={draft}
          onChangeText={onDraftChange}
          keyboardType={keyboardType === "decimal-pad" ? "decimal-pad" : "default"}
          autoFocus
          testID={`${testID}-input`}
        />
        <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" onPress={() => onDismiss?.()}>
              {t("driver.refuel.cancel")}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button onPress={onCommit} testID={`${testID}-update`}>
              {t("driver.refuel.update")}
            </Button>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: theme.spacing[3],
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.ui03,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text preset="label01" color={theme.colors.textSecondary}>
          {label}
        </Text>
        <Text preset="body02" color={theme.colors.textPrimary}>
          {value === undefined || value === null || value === "" ? "—" : String(value)}
        </Text>
      </View>
      {readOnly || !onEdit ? null : (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${t("driver.refuel.edit")} ${label}`}
          onPress={onEdit}
          hitSlop={8}
          testID={`${testID}-edit-button`}
          style={{ minHeight: theme.sizing.minTouchTarget, justifyContent: "center", paddingLeft: theme.spacing[4] }}
        >
          <Icon name="edit" size={20} color={theme.colors.interactive01} />
        </TouchableOpacity>
      )}
    </View>
  )
}
