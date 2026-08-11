// packages/mobile/src/screens/driver/AccidentDetailScreen.tsx
//
// B.15 Accident Detail. Status + description + media gallery + escalation status (armed timer /
// acknowledged / escalated tier, live via the `driver:accident` socket) with the two driver actions:
// Acknowledge (when on-call/responsible) and Add media. Telemetry-chain verify result is read-only.
// Self-fetching via `services.accidents.getOne(id)`; Acknowledge posts through the same service.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Icon } from "@/design/components/Icon"
import { PhotoCapture, type CapturedPhoto } from "@/design/components/PhotoCapture"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { AccidentDetail as AccidentDetailModel } from "@/core/driver/accidents"

export interface AccidentMedia {
  media_id: string
  /** PHOTO | VIDEO — only used to pick the tile icon. */
  kind?: string | null
  /** True while the asset is still queued locally (D-6). */
  pending?: boolean
}

export interface AccidentDetail {
  accident_id: string
  reference?: string | null
  occurred_at?: string
  reported_at?: string
  /** REPORTED | ACKNOWLEDGED | UNDER_REVIEW | ESCALATED | RESOLVED | CLOSED */
  status?: string | null
  severity?: string | null
  mayday?: boolean
  description?: string | null
  location_label?: string | null
  vehicle_label?: string | null
  escalation_tier?: number | null
  acknowledged_by?: string | null
  seconds_to_escalation?: number | null
  chain_valid?: boolean | null
  media?: AccidentMedia[]
  /** Whether this driver may acknowledge (on-call/responsible). */
  can_acknowledge?: boolean
}

export interface AccidentDetailScreenProps {
  services: Services
  id: string
  onBack: () => void
}

/** Map the service read model (`GET /accidents/{id}`) onto this screen's view model. */
function toDetail(a: AccidentDetailModel): AccidentDetail {
  return {
    accident_id: a.accident_id,
    reference: a.reference,
    occurred_at: a.occurred_at ?? undefined,
    reported_at: a.reported_at ?? undefined,
    status: a.status,
    severity: a.severity,
    mayday: a.mayday ?? false,
    description: a.description ?? a.driver_statement ?? null,
    location_label: a.location_label,
    vehicle_label: a.vehicle_label,
    escalation_tier: a.escalation_tier,
    acknowledged_by: a.acknowledged_by,
    seconds_to_escalation: a.seconds_to_escalation,
    chain_valid: a.chain_valid,
    media: (a.media ?? []).map((m) => ({ media_id: m.media_id, kind: m.kind, pending: m.pending })),
    can_acknowledge: a.can_acknowledge ?? false,
  }
}


function statusTone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "RESOLVED":
    case "CLOSED":
      return "success"
    case "ESCALATED":
      return "danger"
    case "UNDER_REVIEW":
      return "warning"
    case "ACKNOWLEDGED":
      return "info"
    default:
      return "neutral"
  }
}

function formatWhen(iso?: string): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleString()
}

export function AccidentDetailScreen({ services, id, onBack }: AccidentDetailScreenProps) {
  const [accident, setAccident] = useState<AccidentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAccident(toDetail(await services.accidents.getOne(id)))
    } catch {
      setAccident(null)
    } finally {
      setLoading(false)
    }
  }, [services, id])

  useEffect(() => {
    void load()
  }, [load])

  const onAcknowledge = async () => {
    setSubmitting(true)
    try {
      await services.accidents.acknowledge(id)
      await load()
    } catch {
      // Domain/transport failure — the escalation card keeps showing the current state.
    } finally {
      setSubmitting(false)
    }
  }

  // Attaching a scene photo uploads the evidence then binds it to the ADDITIONAL slot (3.1).
  const onCaptured = async (photo: CapturedPhoto) => {
    setCapturing(false)
    setSubmitting(true)
    try {
      await services.accidents.attachMedia(id, "ADDITIONAL", photo)
      await load()
    } catch {
      // Offline → the service parks it in the outbox; the gallery refreshes on the next load.
    } finally {
      setSubmitting(false)
    }
  }

  if (!accident) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="accident-detail-screen">
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
          <Button
            variant="ghost"
            fullWidth={false}
            onPress={onBack}
            icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
            label={t("common.back")}
            testID="accident-detail-back"
          />
        </View>
        <EmptyState
          icon={<Icon name="report_problem" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("driver.accident.empty")}
          testID="accident-detail-empty"
        />
      </ScrollView>
    )
  }

  const media = accident.media ?? []

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="accident-detail-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="accident-detail-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{accident.reference ?? t("driver.accident.detailTitle")}</Text>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.accident.reportedAt", { when: formatWhen(accident.reported_at ?? accident.occurred_at) })}
          </Text>
        </View>
        <StatusBadge label={t(`driver.accident.status.${accident.status ?? "REPORTED"}`)} tone={statusTone(accident.status)} />
      </View>

      {accident.mayday ? (
        <Card variant="container" accent={theme.colors.supportError} style={{ marginTop: theme.spacing[4] }} testID="accident-mayday-flag">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            <Icon name="warning" size={theme.sizing.iconLg} color={theme.colors.error} filled />
            <Text preset="bodyStrong" color={theme.colors.onErrorContainer} style={{ flex: 1 }}>
              {t("driver.accident.maydayFlag")}
            </Text>
          </View>
        </Card>
      ) : null}

      <Card variant="container" style={{ marginTop: theme.spacing[4] }} title={t("driver.accident.description")}>
        <Text preset="body02" color={theme.colors.onSurfaceVariant}>
          {accident.description ?? t("common.notAvailable")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
          <Icon name="location_on" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ flexShrink: 1 }}>
            {accident.location_label ?? t("driver.accident.locationUnavailable")}
          </Text>
        </View>
        {accident.vehicle_label ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[2] }}>
            <Icon name="local_shipping" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
            <Text preset="caption" color={theme.colors.onSurfaceVariant}>
              {accident.vehicle_label}
            </Text>
          </View>
        ) : null}
        {accident.severity ? (
          <View style={{ marginTop: theme.spacing[3] }}>
            <StatusBadge label={accident.severity} tone="warning" />
          </View>
        ) : null}
      </Card>

      <Card
        variant="container"
        title={t("driver.accident.mediaGallery")}
        trailing={<StatusBadge label={t("driver.accident.mediaCount", { count: media.length })} tone="neutral" />}
        testID="accident-media"
      >
        {media.length === 0 ? (
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {t("driver.accident.noMedia")}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] }}>
            {media.map((m) => (
              <View
                key={m.media_id}
                testID={`accident-media-${m.media_id}`}
                style={{
                  width: 88,
                  height: 88,
                  backgroundColor: theme.colors.ui03,
                  borderWidth: 1,
                  borderColor: theme.colors.outlineVariant,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: theme.spacing[1],
                }}
              >
                <Icon
                  name={m.kind === "VIDEO" ? "videocam" : "image"}
                  size={theme.sizing.iconLg}
                  color={theme.colors.onSurfaceVariant}
                />
                {m.pending ? (
                  <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                    {t("common.pending")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
        <View style={{ marginTop: theme.spacing[4] }}>
          {capturing ? (
            <PhotoCapture
              label={t("driver.accident.addMedia")}
              onCapture={(p) => void onCaptured(p)}
              onRemove={() => setCapturing(false)}
              testID="accident-media-capture"
            />
          ) : (
            <Button
              variant="secondary"
              onPress={() => setCapturing(true)}
              loading={submitting}
              icon={<Icon name="add_a_photo" size={theme.sizing.iconMd} color={theme.colors.primary} />}
              label={t("driver.accident.addMedia")}
              testID="accident-add-media"
            />
          )}
        </View>
      </Card>

      <Card variant="container" title={t("driver.accident.escalation")} testID="accident-escalation">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
          <Icon name="schedule" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
          <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ flex: 1 }}>
            {accident.acknowledged_by
              ? t("driver.accident.acknowledged", { name: accident.acknowledged_by })
              : accident.seconds_to_escalation !== null && accident.seconds_to_escalation !== undefined
                ? t("admin.accidents.timeRemaining", { seconds: accident.seconds_to_escalation })
                : t("driver.accident.awaitingAck")}
          </Text>
        </View>
        {accident.escalation_tier !== null && accident.escalation_tier !== undefined ? (
          <View style={{ marginTop: theme.spacing[3] }}>
            <StatusBadge label={t("admin.accidents.escalationTier", { tier: accident.escalation_tier })} tone="info" />
          </View>
        ) : null}
        {accident.chain_valid !== null && accident.chain_valid !== undefined ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginTop: theme.spacing[3] }}>
            <Icon
              name={accident.chain_valid ? "check_circle" : "error"}
              size={theme.sizing.iconMd}
              color={accident.chain_valid ? theme.colors.success : theme.colors.error}
            />
            <Text preset="caption" color={accident.chain_valid ? theme.colors.success : theme.colors.error}>
              {accident.chain_valid ? t("driver.accident.chainValid") : t("driver.accident.chainInvalid")}
            </Text>
          </View>
        ) : null}
      </Card>

      {accident.can_acknowledge ? (
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            onPress={() => void onAcknowledge()}
            loading={submitting}
            icon={<Icon name="check_circle" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
            label={t("driver.accident.acknowledge")}
            testID="accident-acknowledge"
          />
        </View>
      ) : null}
    </ScrollView>
  )
}
