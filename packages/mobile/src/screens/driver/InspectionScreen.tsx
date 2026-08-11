// packages/mobile/src/screens/driver/InspectionScreen.tsx
//
// DVIR submission (1.1). The host supplies a template (id + items); the driver marks each PASS/FAIL/
// N/A and must attach a photo for every FAIL. Presentational — `onSubmit` carries the built payload.

import React, { useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { Text } from "@/design/components/Text"
import { Input } from "@/design/components/Input"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { PhotoCapture, type CapturedPhoto } from "@/design/components/PhotoCapture"
import { ErrorState } from "@/design/components/ErrorState"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { AppError } from "@/core/error"
import type { InspectionItemInput } from "@fleet/shared/mobile"

export interface InspectionTemplateItem {
  template_item_id: string
  label: string
}

export interface InspectionScreenProps {
  templateId: string
  vehicleId: string
  shiftId: string
  items: InspectionTemplateItem[]
  submitting: boolean
  error?: AppError
  onSubmit: (params: { previous_defects_reviewed: boolean; signature_name: string; items: InspectionItemInput[] }, evidence: Record<string, CapturedPhoto>) => void
  onCancel: () => void
}

type Result = "PASS" | "FAIL" | "NOT_APPLICABLE"

export function InspectionScreen({ templateId, vehicleId, shiftId, items, submitting, error, onSubmit, onCancel }: InspectionScreenProps) {
  const [results, setResults] = useState<Record<string, Result>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<Record<string, CapturedPhoto>>({})
  const [reviewed, setReviewed] = useState(false)
  const [signature, setSignature] = useState("")
  const [localError, setLocalError] = useState<string>()

  void templateId
  void vehicleId
  void shiftId

  const submit = () => {
    const built: InspectionItemInput[] = items.map((it) => ({
      template_item_id: it.template_item_id,
      result: results[it.template_item_id] ?? "PASS",
      notes: notes[it.template_item_id]?.trim() || undefined,
    }))
    if (built.some((i) => i.result === "FAIL" && !photos[i.template_item_id])) {
      return setLocalError(t("driver.dvir.failNeedsPhoto"))
    }
    if (!reviewed) return setLocalError(t("driver.dvir.defectsReviewed"))
    if (!signature.trim()) return setLocalError(t("driver.dvir.signature"))
    setLocalError(undefined)
    onSubmit({ previous_defects_reviewed: reviewed, signature_name: signature.trim(), items: built }, photos)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="inspection-screen">
      <Text preset="heading03">{t("driver.dvir.title")}</Text>

      {items.map((it) => (
        <Card key={it.template_item_id} style={{ marginTop: theme.spacing[3] }}>
          <Text preset="heading03">{it.label}</Text>
          <View style={{ flexDirection: "row", marginTop: theme.spacing[2] }}>
            {(["PASS", "FAIL", "NOT_APPLICABLE"] as Result[]).map((r) => (
              <Button
                key={r}
                variant={results[it.template_item_id] === r ? "primary" : "ghost"}
                onPress={() => setResults((s) => ({ ...s, [it.template_item_id]: r }))}
                style={{ marginRight: theme.spacing[2] }}
                testID={`item-${it.template_item_id}-${r}`}
              >
                {t(`driver.dvir.${r === "NOT_APPLICABLE" ? "notApplicable" : r.toLowerCase()}`)}
              </Button>
            ))}
          </View>
          <Input label={t("driver.dvir.itemNotes")} value={notes[it.template_item_id] ?? ""} onChangeText={(v) => setNotes((s) => ({ ...s, [it.template_item_id]: v }))} />
          {(results[it.template_item_id] ?? "PASS") === "FAIL" && (
            <PhotoCapture label={t("driver.dvir.itemPhoto")} required value={photos[it.template_item_id] ?? null} onCapture={(p) => setPhotos((s) => ({ ...s, [it.template_item_id]: p }))} testID={`item-photo-${it.template_item_id}`} />
          )}
        </Card>
      ))}

      <Card style={{ marginTop: theme.spacing[4] }}>
        <TouchableRow checked={reviewed} label={t("driver.dvir.defectsReviewed")} onPress={() => setReviewed((v) => !v)} />
        <Input label={t("driver.dvir.signature")} value={signature} onChangeText={setSignature} testID="inspection-signature" />
      </Card>

      {localError && <Text style={{ color: theme.colors.supportError, marginTop: theme.spacing[3] }}>{localError}</Text>}
      {error && <ErrorState error={error} />}

      <View style={{ marginTop: theme.spacing[5] }}>
        <Button loading={submitting} onPress={submit} testID="inspection-submit">
          {t("driver.dvir.submit")}
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

function TouchableRow({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="checkbox" onPress={onPress} style={{ flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing[2] }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderWidth: 2,
          borderColor: theme.colors.interactive01,
          backgroundColor: checked ? theme.colors.interactive01 : "transparent",
          marginRight: theme.spacing[3],
        }}
      />
      <Text>{label}</Text>
    </TouchableOpacity>
  )
}
