// packages/mobile/src/screens/admin/HardwareProvisioningScreen.tsx
//
// Hardware & Trackers provisioning centre (A1.1, N2.3). Two stacked concerns:
//
//   1. **Pair Tracker** — vehicle + IMEI + brand/model, submitted to `POST /admin/hardware/pair`.
//      The response carries the installer `smsCommand`, which is shown verbatim in a copyable box:
//      the installer sends that SMS to the tracker SIM to point the device at the Traccar listener.
//   2. **Tracker Status** — `GET /admin/hardware/pending`, polled every 30s, rendered as status rows.
//      Any OFFLINE/LOST tracker raises a danger banner, because an unreachable tracker silently
//      stops every downstream telemetry rule (geofence, speeding, idling).
//
// The model picker is driven by `TRACKER_DEVICE_MODELS` and is scoped to the selected brand, so the
// two pickers behave as one grouped/categorised selection without a heavy dropdown dependency.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { View, ScrollView, TouchableOpacity, Animated, Clipboard as RNClipboard } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { Icon } from "@/design/components/Icon"
import { Banner } from "@/design/components/Banner"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { t } from "@/core/i18n"
import { TRACKER_BRANDS, TRACKER_DEVICE_MODELS, type HardwareTrackerStatus, type TrackerBrand } from "@fleet/shared/mobile"
import type { Services } from "@/services"
import type { HardwarePairResult, VehicleRecord } from "@/core/admin"

/** Tracker roster refresh cadence. Matches the Traccar keep-alive window. */
const POLL_MS = 30_000

/** `HardwarePairSchema.trackerImei` is exactly 15 digits. */
const IMEI_LENGTH = 15

type TrackerStatus = HardwareTrackerStatus["status"]

const STATUS_TONE: Record<TrackerStatus, BadgeTone> = {
  PENDING: "warning",
  ONLINE: "success",
  OFFLINE: "danger",
  LOST: "danger",
}

const STATUS_LABEL_KEY: Record<TrackerStatus, string> = {
  PENDING: "admin.hardware.pending",
  ONLINE: "admin.hardware.online",
  OFFLINE: "admin.hardware.offline",
  LOST: "admin.hardware.lost",
}

export interface HardwareProvisioningScreenProps {
  services: Services
  onBack: () => void
}

/** Copies to the clipboard, tolerating hosts where the RN `Clipboard` module is unavailable. */
function copyToClipboard(value: string): boolean {
  try {
    RNClipboard.setString(value)
    return true
  } catch {
    return false
  }
}

export function HardwareProvisioningScreen({ services, onBack }: HardwareProvisioningScreenProps) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(services.admin.vehicles.vehicles)
  const [trackers, setTrackers] = useState<HardwareTrackerStatus[]>(services.admin.hardware.trackers)
  const [vehicleId, setVehicleId] = useState<string>("")
  const [imei, setImei] = useState("")
  const [brand, setBrand] = useState<TrackerBrand>(TRACKER_BRANDS[0] ?? "GENERIC_H02")
  const [model, setModel] = useState<string>("")
  const [simNumber, setSimNumber] = useState("")
  const [result, setResult] = useState<HardwarePairResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // ---- data -------------------------------------------------------------------------------

  const loadTrackers = useCallback(async () => {
    try {
      setTrackers(await services.admin.hardware.listPending())
    } catch {
      // Poll failures are non-fatal: keep the last known roster on screen.
    }
  }, [services])

  useEffect(() => {
    void services.admin.vehicles.load().then(() => setVehicles([...services.admin.vehicles.vehicles]))
    void loadTrackers()
  }, [services, loadTrackers])

  // 30s status poll (testID `hw-status-poll` marks the polled region).
  useEffect(() => {
    const timer = setInterval(() => void loadTrackers(), POLL_MS)
    return () => clearInterval(timer)
  }, [loadTrackers])

  // Auto-dismiss the "SMS copied" toast.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(timer)
  }, [toast])

  // ---- derived ----------------------------------------------------------------------------

  const modelsForBrand = useMemo(
    () => TRACKER_DEVICE_MODELS.find((g) => g.brand === brand)?.models ?? [],
    [brand],
  )

  // Selecting a new brand invalidates a model belonging to the previous brand.
  useEffect(() => {
    if (model && !modelsForBrand.includes(model)) setModel("")
  }, [modelsForBrand, model])

  const imeiValid = new RegExp(`^[0-9]{${IMEI_LENGTH}}$`).test(imei)
  const imeiError = imei.length > 0 && !imeiValid ? t("admin.hardware.imeiInvalid") : null
  const canSubmit = !!vehicleId && imeiValid && !!brand && !busy

  const degraded = trackers.filter((tr) => tr.status === "OFFLINE" || tr.status === "LOST")

  // ---- actions ----------------------------------------------------------------------------

  const submitPair = async (keepImei = false) => {
    if (!vehicleId || !imeiValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await services.admin.hardware.pair({
        vehicleId,
        trackerImei: imei,
        trackerBrand: brand,
        ...(simNumber ? { trackerSimNumber: simNumber } : {}),
      })
      setResult(res)
      if (!keepImei) void loadTrackers()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.unknownError"))
    } finally {
      setBusy(false)
    }
  }

  /** Re-issues the pairing call for a roster row so its SMS command can be shown again. */
  const resend = async (tracker: HardwareTrackerStatus) => {
    const vehicle = vehicles.find((v) => v.license_plate === tracker.vehiclePlate)
    if (!vehicle) {
      setError(t("admin.hardware.resendNoVehicle"))
      return
    }
    setVehicleId(vehicle.id)
    setImei(tracker.imei)
    if (tracker.brand) setBrand(tracker.brand as TrackerBrand)
    setBusy(true)
    setError(null)
    try {
      const res = await services.admin.hardware.pair({
        vehicleId: vehicle.id,
        trackerImei: tracker.imei,
        trackerBrand: (tracker.brand ?? "GENERIC_H02") as TrackerBrand,
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.unknownError"))
    } finally {
      setBusy(false)
    }
  }

  const copySms = () => {
    if (!result?.smsCommand) return
    if (copyToClipboard(result.smsCommand)) setToast(t("admin.hardware.copiedToast"))
  }

  // ---- render -----------------------------------------------------------------------------

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-hardware">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <Text preset="heading03">{t("admin.hardware.title")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {degraded.length > 0 ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <Banner
            tone="danger"
            testID="hw-degraded-banner"
            message={t("admin.hardware.degradedBanner", { count: degraded.length })}
          />
        </View>
      ) : null}

      {toast ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <Banner tone="success" message={toast} testID="hw-toast" />
        </View>
      ) : null}

      {/* ---- Pair Tracker ---- */}
      <Card variant="container" title={t("admin.hardware.pairTitle")} style={{ marginBottom: theme.spacing[4] }}>
        <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[2] }}>
          {t("admin.hardware.vehicle")}
        </Text>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginBottom: theme.spacing[4] }}
          testID="hw-pair-vehicle"
        >
          {vehicles.length === 0 ? (
            <Text preset="body02" color={theme.colors.textSecondary}>
              {t("common.loading")}
            </Text>
          ) : (
            vehicles.map((v) => (
              <ChoiceChip
                key={v.id}
                label={v.license_plate}
                selected={vehicleId === v.id}
                onPress={() => setVehicleId(v.id)}
              />
            ))
          )}
        </View>

        <Input
          label={t("admin.hardware.imei")}
          value={imei}
          onChangeText={(v) => setImei(v.replace(/[^0-9]/g, "").slice(0, IMEI_LENGTH))}
          keyboardType="number-pad"
          maxLength={IMEI_LENGTH}
          required
          error={imeiError}
          helperText={t("admin.hardware.imeiHelper", { length: IMEI_LENGTH })}
          testID="hw-pair-imei"
        />

        <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[2] }}>
          {t("admin.hardware.brand")}
        </Text>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginBottom: theme.spacing[4] }}
          testID="hw-pair-brand"
        >
          {TRACKER_BRANDS.map((b) => (
            <ChoiceChip key={b} label={b} selected={brand === b} onPress={() => setBrand(b)} />
          ))}
        </View>

        <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[2] }}>
          {t("admin.hardware.model")}
        </Text>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginBottom: theme.spacing[4] }}
          testID="hw-pair-model"
        >
          {modelsForBrand.length === 0 ? (
            <Text preset="body02" color={theme.colors.textSecondary}>
              {t("admin.hardware.noModels")}
            </Text>
          ) : (
            modelsForBrand.map((m) => (
              <ChoiceChip key={m} label={m} selected={model === m} onPress={() => setModel(m)} />
            ))
          )}
        </View>

        <Input
          label={t("admin.hardware.simNumber")}
          value={simNumber}
          onChangeText={setSimNumber}
          keyboardType="phone-pad"
          testID="hw-pair-sim"
        />

        {error ? (
          <Text preset="body02" color={theme.colors.supportError} style={{ marginBottom: theme.spacing[3] }}>
            {error}
          </Text>
        ) : null}

        <Button
          variant="primary"
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void submitPair()}
          testID="hw-pair-submit"
        >
          {t("admin.hardware.pair")}
        </Button>
      </Card>

      {/* ---- SMS command ---- */}
      {result ? (
        <Card
          variant="container"
          title={t("admin.hardware.smsCommand")}
          accent={result.success ? theme.colors.supportSuccess : theme.colors.supportError}
          style={{ marginBottom: theme.spacing[4] }}
        >
          <Text preset="body02" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[3] }}>
            {result.message}
          </Text>
          <View
            style={{
              backgroundColor: theme.colors.surfaceContainerHigh,
              borderWidth: 1,
              borderColor: theme.colors.outlineVariant,
              padding: theme.spacing[4],
              marginBottom: theme.spacing[3],
            }}
          >
            <Text preset="body02" selectable testID="hw-sms-command">
              {result.smsCommand}
            </Text>
          </View>
          {result.simNumber ? (
            <Text preset="label" color={theme.colors.textSecondary} style={{ marginBottom: theme.spacing[3] }}>
              {t("admin.hardware.simNumber")}: {result.simNumber}
            </Text>
          ) : null}
          <Button
            variant="secondary"
            onPress={copySms}
            icon={<Icon name="content_copy" size={20} color={theme.colors.primary} />}
            testID="hw-copy-sms"
          >
            {t("admin.hardware.copySms")}
          </Button>
        </Card>
      ) : null}

      {/* ---- Tracker status (polled) ---- */}
      <Card variant="container" title={t("admin.hardware.trackerStatus")} testID="hw-status-poll">
        {trackers.length === 0 ? (
          <EmptyState
            title={t("admin.hardware.noTrackers")}
            icon={<Icon name="settings" size={32} color={theme.colors.outline} />}
          />
        ) : (
          trackers.map((tr) => (
            <TrackerRow key={tr.imei} tracker={tr} busy={busy} onResend={() => void resend(tr)} />
          ))
        )}
      </Card>
    </ScrollView>
  )
}

/** Square Carbon-style selectable chip — the lightweight stand-in for a picker. */
function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[3],
        minHeight: theme.sizing.minTouchTarget,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? theme.colors.interactive01 : theme.colors.outlineVariant,
        backgroundColor: selected ? theme.colors.infoContainer : theme.colors.ui01,
      }}
    >
      <Text preset="label" color={selected ? theme.colors.interactive01 : theme.colors.onSurface}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

/**
 * One tracker on the status board. `LOST` pulses via opacity so a stolen/removed unit is visible
 * without reading the badge text.
 */
function TrackerRow({
  tracker,
  busy,
  onResend,
}: {
  tracker: HardwareTrackerStatus
  busy: boolean
  onResend: () => void
}) {
  const blink = useRef(new Animated.Value(1)).current
  const lost = tracker.status === "LOST"

  useEffect(() => {
    if (!lost) {
      blink.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [lost, blink])

  return (
    <Card
      variant="surface"
      accent={STATUS_TONE[tracker.status] === "danger" ? theme.colors.supportError : undefined}
      style={{ marginBottom: theme.spacing[3] }}
      testID="hw-tracker-row"
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing[3] }}>
        <View style={{ flex: 1 }}>
          <Text preset="body02">{tracker.vehiclePlate}</Text>
          <Text preset="label" color={theme.colors.textSecondary}>
            {tracker.imei}
            {tracker.brand ? ` · ${tracker.brand}` : ""}
          </Text>
        </View>
        <Animated.View style={{ opacity: blink }}>
          <StatusBadge label={t(STATUS_LABEL_KEY[tracker.status])} tone={STATUS_TONE[tracker.status]} />
        </Animated.View>
      </View>

      <View style={{ flexDirection: "row", gap: theme.spacing[5], marginTop: theme.spacing[3] }}>
        <View>
          <Text preset="label" color={theme.colors.textSecondary}>
            {t("admin.hardware.pairedAt")}
          </Text>
          <Text preset="body02">{tracker.pairedAt ?? t("common.notAvailable")}</Text>
        </View>
        <View>
          <Text preset="label" color={theme.colors.textSecondary}>
            {t("admin.hardware.lastPing")}
          </Text>
          <Text preset="body02">{tracker.lastPing ?? t("common.notAvailable")}</Text>
        </View>
      </View>

      <View style={{ marginTop: theme.spacing[3] }}>
        <Button
          variant="ghost"
          loading={busy}
          onPress={onResend}
          icon={<Icon name="refresh" size={20} color={theme.colors.primary} />}
          testID="hw-resend"
        >
          {t("admin.hardware.resend")}
        </Button>
      </View>
    </Card>
  )
}
