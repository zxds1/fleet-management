// packages/mobile/src/screens/driver/ClockInScreen.tsx
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

export interface ClockInScreenProps {
  consentVersion: string
  submitting: boolean
  error?: AppError
  onSubmit: (params: { start_odometer_km: number; start_fuel_gauge: FuelGaugeLevel }, photo: CapturedPhoto) => void
  onCancel: () => void
}

const GAUGES: FuelGaugeLevel[] = ["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]

export function ClockInScreen({ consentVersion, submitting, error, onSubmit, onCancel }: ClockInScreenProps) {
  const [odometer, setOdometer] = useState("")
  const [gauge, setGauge] = useState<FuelGaugeLevel>("HALF")
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [localError, setLocalError] = useState<string>()

  const submit = () => {
    const km = Number(odometer)
    if (!odometer.trim() || !Number.isInteger(km) || km < 0) return setLocalError(t("driver.clockIn.startOdometer"))
    if (!photo) return setLocalError(t("driver.clockIn.photoRequired"))
    setLocalError(undefined)
    onSubmit({ start_odometer_km: km, start_fuel_gauge: gauge }, photo)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="clockin-screen">
      <Text preset="heading03">{t("driver.clockIn.title")}</Text>
      <Text style={{ color: theme.colors.textSecondary, marginVertical: theme.spacing[3] }}>
        {t("consent.policyVersion", { version: consentVersion })}
      </Text>

      <Input
        label={t("driver.clockIn.startOdometer")}
        value={odometer}
        onChangeText={setOdometer}
        keyboardType="numeric"
        testID="clockin-odometer"
      />

      <Card style={{ marginTop: theme.spacing[4] }}>
        <Text preset="label01" style={{ color: theme.colors.textSecondary }}>
          {t("driver.clockIn.startGauge")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing[2] }}>
          {GAUGES.map((g) => (
            <Button
              key={g}
              variant={gauge === g ? "primary" : "ghost"}
              onPress={() => setGauge(g)}
              style={{ margin: theme.spacing[1] }}
              testID={`gauge-${g}`}
            >
              {g}
            </Button>
          ))}
        </View>
      </Card>

      <PhotoCapture label={t("driver.clockIn.startPhoto")} required value={photo} onCapture={setPhoto} testID="clockin-photo" />

      {localError && <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }}>{localError}</Text>}
      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button loading={submitting} onPress={submit} testID="clockin-submit">
          {t("driver.clockIn.submit")}
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
