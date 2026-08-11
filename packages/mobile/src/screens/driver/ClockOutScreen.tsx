// packages/mobile/src/screens/driver/ClockOutScreen.tsx
import React, { useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { PhotoCapture, type CapturedPhoto } from "@/design/components/PhotoCapture"
import { ErrorState } from "@/design/components/ErrorState"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { AppError } from "@/core/error"
import type { FuelGaugeLevel } from "@fleet/shared/mobile"

export interface ClockOutScreenProps {
  shiftId: string
  submitting: boolean
  error?: AppError
  onSubmit: (odometerKm: number, gauge: FuelGaugeLevel, photo: CapturedPhoto, notes: string) => void
  onCancel: () => void
}

const GAUGES: FuelGaugeLevel[] = ["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]

export function ClockOutScreen({ shiftId, submitting, error, onSubmit, onCancel }: ClockOutScreenProps) {
  const [odometer, setOdometer] = useState("")
  const [gauge, setGauge] = useState<FuelGaugeLevel>("HALF")
  const [notes, setNotes] = useState("")
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [localError, setLocalError] = useState<string>()

  const submit = () => {
    if (!shiftId) return setLocalError(t("driver.home.noActiveShift"))
    const km = Number(odometer)
    if (!odometer.trim() || !Number.isInteger(km) || km < 0) return setLocalError(t("driver.clockOut.endOdometer"))
    if (!photo) return setLocalError(t("driver.clockIn.photoRequired"))
    setLocalError(undefined)
    onSubmit(km, gauge, photo, notes)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="clockout-screen">
      <Text preset="heading03">{t("driver.clockOut.title")}</Text>

      <Input
        label={t("driver.clockOut.endOdometer")}
        value={odometer}
        onChangeText={setOdometer}
        keyboardType="numeric"
        testID="clockout-odometer"
      />

      <Card style={{ marginTop: theme.spacing[4] }}>
        <Text preset="label01" style={{ color: theme.colors.textSecondary }}>
          {t("driver.clockOut.endGauge")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing[2] }}>
          {GAUGES.map((g) => (
            <Button key={g} variant={gauge === g ? "primary" : "ghost"} onPress={() => setGauge(g)} style={{ margin: theme.spacing[1] }}>
              {g}
            </Button>
          ))}
        </View>
      </Card>

      <Input
        label={t("driver.clockOut.notes")}
        value={notes}
        onChangeText={setNotes}
        multiline
        testID="clockout-notes"
      />

      <PhotoCapture label={t("driver.clockOut.endPhoto")} required value={photo} onCapture={setPhoto} testID="clockout-photo" />

      {localError && <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }}>{localError}</Text>}
      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button loading={submitting} onPress={submit} testID="clockout-submit">
          {t("driver.clockOut.submit")}
        </Button>
        <View style={{ marginTop: theme.spacing[3] }}>
          <Button variant="ghost" onPress={onCancel}>
            {t("common.cancel")}
          </Button>
        </View>
      </View>
    </ScrollView>
  )
}
