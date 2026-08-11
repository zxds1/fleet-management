// packages/mobile/src/screens/admin/SettingsTriggersScreen.tsx
//
// Alert & trigger settings (spec `system_settings_triggers`). Reads the trigger config from
// `GET /admin/settings/triggers` and lets the admin toggle each one, persisting with
// `PUT /admin/settings/triggers`. The save is best-effort per key — a single failing key does not
// abort the others, and the footer reports how many were applied. A trigger's `value` is an opaque
// JSON value whose shape depends on `value_type`; we treat booleans as the enabled flag and numbers
// as a threshold, falling back to "on/off" for everything else.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Toggle } from "@/design/components/Toggle"
import { Icon } from "@/design/components/Icon"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { TriggerSetting } from "@/core/admin"

export interface SettingsTriggersScreenProps {
  services: Services
  onBack: () => void
}

interface LocalTrigger {
  key: string
  enabled: boolean
  /** Optional numeric threshold carried on the boolean/numeric trigger. */
  threshold?: number
  description: string
  changed: boolean
}

function toLocal(tr: TriggerSetting): LocalTrigger {
  const v = tr.value
  const enabled = typeof v === "boolean" ? v : typeof v === "number" ? v > 0 : true
  const threshold = typeof v === "number" ? v : undefined
  return { key: tr.key, enabled, threshold, description: tr.description ?? "", changed: false }
}

export function SettingsTriggersScreen({ services, onBack }: SettingsTriggersScreenProps) {
  const [triggers, setTriggers] = useState<LocalTrigger[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [busy, setBusy] = useState(false)
  const [saveNote, setSaveNote] = useState<string>()

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      const list = await services.admin.settings.load()
      setTriggers(list.map(toLocal))
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
    const off = services.admin.settings.onChange(() => setTriggers(services.admin.settings.triggers.map(toLocal)))
    return off
  }, [services, refresh])

  const toggle = (key: string, enabled: boolean) => {
    setTriggers((prev) => prev.map((tr) => (tr.key === key ? { ...tr, enabled, changed: true } : tr)))
    setSaveNote(undefined)
  }

  const setThreshold = (key: string, threshold: number) => {
    setTriggers((prev) => prev.map((tr) => (tr.key === key ? { ...tr, threshold, enabled: true, changed: true } : tr)))
    setSaveNote(undefined)
  }

  const save = async () => {
    setBusy(true)
    setSaveNote(undefined)
    const changed = triggers.filter((tr) => tr.changed)
    const changes: Record<string, unknown> = {}
    for (const tr of changed) changes[tr.key] = tr.threshold != null ? tr.threshold : tr.enabled
    try {
      const result = await services.admin.settings.saveAll(changes)
      setSaveNote(
        result.failed.length === 0
          ? t("admin.settings.saved")
          : t("admin.settings.savedPartial", { saved: result.saved.length, failed: result.failed.length }),
      )
      const fresh = await services.admin.settings.load().catch(() => [])
      setTriggers(fresh.map(toLocal))
    } catch (e) {
      setSaveNote(fromUnknown(e).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-settings">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <Text preset="heading03">{t("admin.settings.title")}</Text>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[3] }}>
        {t("admin.settings.subtitle")}
      </Text>

      {error ? (
        <ErrorState error={error} onAction={() => void refresh()} />
      ) : null}

      {loading ? (
        <Card variant="container">
          <Skeleton width="100%" height={24} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="100%" height={24} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="100%" height={24} />
        </Card>
      ) : triggers.length === 0 ? (
        <EmptyState
          title={t("admin.settings.empty")}
          description={t("admin.settings.emptyDescription")}
          icon={<Icon name="notifications_active" size={32} color={theme.colors.outline} />}
        />
      ) : (
        triggers.map((tr) => {
          // `t()` has no `fallback` option: it returns the key itself when missing, so an
          // unknown trigger key would render "admin.settings.trigger.<key>.label" verbatim.
          const labelKey = `admin.settings.trigger.${tr.key}.label`
          const helpKey = `admin.settings.trigger.${tr.key}.help`
          const label = t(labelKey) === labelKey ? tr.key : t(labelKey)
          const help = t(helpKey) === helpKey ? tr.description : t(helpKey)
          return (
            <Card key={tr.key} variant="container" testID={`trigger-${tr.key}`} style={{ marginBottom: theme.spacing[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
                  <Text preset="bodyStrong">{label}</Text>
                  <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                    {help}
                  </Text>
                </View>
                <Toggle
                  value={tr.enabled}
                  onValueChange={(v) => toggle(tr.key, v)}
                  label={label}
                  testID={`trigger-toggle-${tr.key}`}
                />
              </View>
              {tr.threshold != null ? (
                <View style={{ marginTop: theme.spacing[3] }}>
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {t("admin.settings.threshold", { value: tr.threshold })}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], marginTop: theme.spacing[2] }}>
                    {[10, 25, 50, 100].map((step) => (
                      <Button
                        key={step}
                        variant={tr.threshold === step ? "primary" : "secondary"}
                        fullWidth={false}
                        onPress={() => setThreshold(tr.key, step)}
                        testID={`trigger-threshold-${tr.key}-${step}`}
                        label={t("admin.settings.thresholdPct", { value: step })}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </Card>
          )
        })
      )}

      {saveNote ? (
        <Text
          preset="caption"
          color={saveNote === t("admin.settings.saved") ? theme.colors.supportSuccess : theme.colors.supportWarning}
          style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[2] }}
        >
          {saveNote}
        </Text>
      ) : null}

      <Button variant="primary" loading={busy} disabled={loading} onPress={save} testID="settings-save" style={{ marginTop: theme.spacing[3] }}>
        {t("admin.settings.save")}
      </Button>
    </ScrollView>
  )
}
