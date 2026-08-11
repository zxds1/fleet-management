// packages/mobile/src/screens/admin/AccidentConsoleScreen.tsx
import React, { useEffect, useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { StatusBadge } from "@/design/components/StatusBadge"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { AccidentEvent } from "@/core/admin"

export interface AccidentConsoleScreenProps {
  services: Services
  offline: boolean
  onBack: () => void
  /** Opens `AccidentDetailScreen` for the tapped accident. */
  onSelectAccident?: (id: string) => void
}

export function AccidentConsoleScreen({ services, onBack, onSelectAccident }: AccidentConsoleScreenProps) {
  const [accidents, setAccidents] = useState<AccidentEvent[]>(services.admin.accidents.accidents)
  const [chain, setChain] = useState<Record<string, { valid: boolean; rows: number }>>({})
  const [error, setError] = useState<string>()

  useEffect(() => {
    const off = services.admin.accidents.onChange(() => setAccidents([...services.admin.accidents.accidents]))
    return off
  }, [services])

  const verify = async (id: string) => {
    try {
      const r = await services.admin.accidents.verifyChain(id)
      setChain((c) => ({ ...c, [id]: { valid: r.allValid, rows: r.rows } }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const acknowledge = (id: string) => {
    services.admin.accidents.acknowledge(id)
    setAccidents([...services.admin.accidents.accidents])
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-accidents">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("admin.accidents.title")}</Text>
        <Button variant="ghost" onPress={onBack}>{t("common.back")}</Button>
      </View>

      {accidents.length === 0 ? (
        <EmptyState title={t("admin.accidents.queueEmpty")} description={t("admin.accidents.queueEmptyDescription")} />
      ) : (
        accidents.map((a) => {
          const c = chain[a.accident_id]
          // Tier 1 (and 0) is the MAYDAY band — the row carries the error accent + a warning glyph.
          const mayday = (a.tier ?? 99) <= 1
          return (
            <Card
              key={a.accident_id}
              accent={mayday ? theme.colors.supportError : undefined}
              style={{ marginBottom: theme.spacing[3] }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!onSelectAccident}
                onPress={() => onSelectAccident?.(a.accident_id)}
                testID="accident-row"
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
                    {mayday ? <Icon name="warning" filled size={theme.sizing.iconLg} color={theme.colors.supportError} /> : null}
                    <Text preset="body02">{a.accident_id.slice(0, 8)}</Text>
                  </View>
                  {a.tier ? <StatusBadge label={t("admin.accidents.escalationTier", { tier: a.tier })} tone={a.tier <= 1 ? "danger" : "warning"} /> : null}
                </View>
                {mayday ? (
                  <Text preset="label" color={theme.colors.supportError} style={{ marginTop: theme.spacing[1] }}>
                    {t("admin.accidents.mayday")}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2], alignItems: "center" }}>
                  {/* Un-acked is a *status*, not an action label — danger tone, distinct copy. */}
                  {a.acknowledged ? (
                    <StatusBadge label={t("admin.accidents.acknowledged")} tone="success" />
                  ) : (
                    <StatusBadge label={t("admin.accidents.awaitingAcknowledgement")} tone="danger" />
                  )}
                  {c ? (
                    <StatusBadge label={c.valid ? t("admin.accidents.chainValid", { rows: c.rows }) : t("admin.accidents.chainInvalid")} tone={c.valid ? "success" : "danger"} />
                  ) : null}
                </View>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
                <Button variant="secondary" onPress={() => verify(a.accident_id)}>{t("admin.accidents.verifyChain")}</Button>
                {!a.acknowledged ? (
                  <Button variant="primary" onPress={() => acknowledge(a.accident_id)}>{t("admin.accidents.acknowledge")}</Button>
                ) : null}
              </View>
            </Card>
          )
        })
      )}
    </ScrollView>
  )
}
