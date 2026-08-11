// packages/mobile/src/screens/driver/AccidentScreen.tsx
//
// Accident journey (3.1 + B17). Two distinct actions: a critical MAYDAY that bypasses evidence, and a
// full report with mandatory scene photos. Presentational; handlers carry the built payloads.

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

export interface AccidentScreenProps {
  shiftId: string | null
  vehicleId: string | null
  submitting: boolean
  error?: AppError
  onMayday: (reason: string) => void
  onReport: (statement: string, frontPhoto: CapturedPhoto) => void
  onCancel: () => void
}

export function AccidentScreen({ shiftId, vehicleId, submitting, error, onMayday, onReport, onCancel }: AccidentScreenProps) {
  const [mode, setMode] = useState<"report" | "mayday">("report")
  const [reason, setReason] = useState("")
  const [statement, setStatement] = useState("")
  const [front, setFront] = useState<CapturedPhoto | null>(null)
  const [localError, setLocalError] = useState<string>()

  void shiftId
  void vehicleId

  const submitMayday = () => {
    if (!reason.trim()) return setLocalError(t("driver.accident.maydayReason"))
    setLocalError(undefined)
    onMayday(reason.trim())
  }

  const submitReport = () => {
    if (!statement.trim()) return setLocalError(t("driver.accident.description"))
    if (!front) return setLocalError(t("driver.accident.addMedia"))
    setLocalError(undefined)
    onReport(statement.trim(), front)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="accident-screen">
      <Text preset="heading03">{t("driver.accident.title")}</Text>

      <Card style={{ marginTop: theme.spacing[4], backgroundColor: theme.colors.supportErrorInverse }}>
        <Button
          variant={mode === "mayday" ? "ghost" : "danger"}
          onPress={() => {
            setMode(mode === "mayday" ? "report" : "mayday")
            setLocalError(undefined)
          }}
          testID="accident-mayday-mode"
        >
          {mode === "mayday" ? t("common.cancel") : t("driver.accident.mayday")}
        </Button>
      </Card>

      {mode === "mayday" ? (
        <View style={{ marginTop: theme.spacing[4] }}>
          <Input label={t("driver.accident.maydayReason")} value={reason} onChangeText={setReason} multiline testID="accident-mayday-reason" />
          {localError && <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }}>{localError}</Text>}
          <View style={{ marginTop: theme.spacing[4] }}>
            <Button variant="danger" loading={submitting} onPress={submitMayday} testID="accident-mayday-submit">
              {t("driver.accident.submitMayday")}
            </Button>
          </View>
        </View>
      ) : (
        <View style={{ marginTop: theme.spacing[4] }}>
          <Input label={t("driver.accident.description")} value={statement} onChangeText={setStatement} multiline testID="accident-statement" />
          <PhotoCapture label={t("driver.accident.addMedia")} required value={front} onCapture={setFront} testID="accident-front" />
          {localError && <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }}>{localError}</Text>}
          <View style={{ marginTop: theme.spacing[4] }}>
            <Button loading={submitting} onPress={submitReport} testID="accident-submit">
              {t("driver.accident.submit")}
            </Button>
          </View>
        </View>
      )}

      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[3] }}>
        <Button variant="ghost" onPress={onCancel}>
          {t("common.cancel")}
        </Button>
      </View>
    </ScrollView>
  )
}
