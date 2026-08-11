// packages/mobile/src/screens/admin/AccidentDetailScreen.tsx
//
// C.7 Accident Detail. Description, media gallery, **Acknowledge** (→ POST /accidents/{id}/acknowledge,
// cancels the escalation timer), **Verify telemetry chain** (→ GET /accidents/{id}/telemetry/verify,
// per-row validity C3.4), escalation timeline and on-call roster. The screen self-fetches via
// `services.admin.accidents.getOne(id)` and re-reads on every `accident:live` push (`onChange`).
//
// Visual reference: `accident_management` + `accident_management_redesign` (MAYDAY banner with
// border-l-4 error accent, countdown card, bento info sections, timeline rail).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView, Image } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { DataTable } from "@/design/components/DataTable"
import { t } from "@/core/i18n"
import type { Services } from "@/services"

/** Minimal shape of `GET /accidents/{id}` — every field optional so partial socket diffs render. */
export interface AccidentMedia {
  media_object_id?: string | null
  uri?: string | null
  kind?: string | null
  captured_at?: string | null
}

export interface AccidentTimelineEntry {
  at?: string | null
  tier?: number | null
  event?: string | null
  detail?: string | null
  /** `DONE` | `CURRENT` | `PENDING` — drives the timeline dot colour. */
  state?: string | null
}

export interface AccidentOnCallContact {
  user_id?: string | null
  full_name?: string | null
  role?: string | null
  phone?: string | null
  tier?: number | null
  notified_at?: string | null
}

export interface AccidentDetail {
  accident_id?: string | null
  is_mayday?: boolean | null
  severity?: string | null
  description?: string | null
  occurred_at?: string | null
  vehicle_plate?: string | null
  driver_name?: string | null
  location_text?: string | null
  latitude?: number | null
  longitude?: number | null
  speed_kph?: number | null
  acknowledged?: boolean | null
  acknowledged_by?: string | null
  acknowledged_at?: string | null
  tier?: number | null
  seconds_to_escalation?: number | null
  media?: AccidentMedia[] | null
  timeline?: AccidentTimelineEntry[] | null
  on_call?: AccidentOnCallContact[] | null
}

export interface TelemetryRow {
  label: string
  valid: boolean
}

export interface AccidentDetailScreenProps {
  services: Services
  /** Accident selected in `AccidentConsoleScreen`. */
  id?: string
  onBack: () => void
  /** Optional overrides — the screen fetches its own data when these are omitted. */
  accident?: AccidentDetail
  onAcknowledge?: () => void
  onVerifyTelemetry?: () => void
  onAddMedia?: () => void
  telemetryRows?: TelemetryRow[]
}

function timelineDotColor(state?: string | null): string {
  if (state === "DONE") return theme.colors.error
  if (state === "CURRENT") return theme.colors.primary
  return theme.colors.outlineVariant
}

/** Maps the `AccidentDetail` DTO from `services.admin.accidents.getOne` onto this screen's view shape. */
function toView(dto: NonNullable<Awaited<ReturnType<Services["admin"]["accidents"]["getOne"]>>>): AccidentDetail {
  return {
    accident_id: dto.accident_id,
    is_mayday: dto.mayday ?? null,
    description: dto.description ?? null,
    occurred_at: dto.occurred_at ?? null,
    acknowledged: dto.acknowledged ?? null,
    acknowledged_by: dto.acknowledged_by ?? null,
    tier: dto.escalationTier ?? dto.tier ?? null,
    media: (dto.media ?? []).map((m) => ({ media_object_id: m.slot, uri: m.url, kind: m.slot })),
  }
}

export function AccidentDetailScreen({
  services,
  id,
  onBack,
  accident: accidentProp,
  onAcknowledge,
  onVerifyTelemetry,
  onAddMedia,
  telemetryRows: telemetryRowsProp,
}: AccidentDetailScreenProps) {
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState<AccidentDetail | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryRow[] | undefined>(telemetryRowsProp)

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    const dto = await services.admin.accidents.getOne(id)
    setFetched(dto ? toView(dto) : null)
    setLoading(false)
  }, [services, id])

  // Fetch on mount and re-render on `accident:live` pushes for this accident.
  useEffect(() => {
    void refresh()
    const off = services.admin.accidents.onChange(() => void refresh())
    return off
  }, [services, refresh])

  const accident = accidentProp ?? fetched
  const acknowledged = accident?.acknowledged === true
  const media = accident?.media ?? []
  const timeline = accident?.timeline ?? []
  const onCall = accident?.on_call ?? []
  const telemetryRows = telemetryRowsProp ?? telemetry
  const chainValid = telemetryRows ? telemetryRows.every((r) => r.valid) : undefined

  const acknowledge = async () => {
    setBusy(true)
    try {
      if (onAcknowledge) onAcknowledge()
      else if (id) services.admin.accidents.acknowledge(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const verifyTelemetry = async () => {
    if (onVerifyTelemetry) {
      onVerifyTelemetry()
      return
    }
    if (!id) return
    const res = await services.admin.accidents.verifyChain(id)
    setTelemetry(
      Array.from({ length: res.rows }, (_, i) => ({
        label: t("admin.accidentDetail.telemetryRow", { sequence: i + 1 }),
        valid: res.allValid,
      })),
    )
  }

  if (loading || !accident) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-accident-detail">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.accidentDetail.title")}
          </Text>
          <Button variant="ghost" fullWidth={false} onPress={onBack}>
            {t("common.back")}
          </Button>
        </View>
        <EmptyState
          title={loading ? t("common.loading") : t("admin.accidents.queueEmpty")}
          description={loading ? undefined : t("admin.accidents.queueEmptyDescription")}
          icon={<Icon name="report_problem" size={32} color={theme.colors.outline} />}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-accident-detail">
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.accidentDetail.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* MAYDAY / severity banner — spec `border-l-4 border-error` */}
      <Card accent={theme.colors.supportError} style={{ backgroundColor: theme.colors.errorContainer }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="warning" size={24} color={theme.colors.error} />
          <View style={{ flex: 1 }}>
            <Text preset="subtitle" color={theme.colors.error}>
              {accident.is_mayday ? t("admin.accidentDetail.maydayTitle") : t("admin.accidentDetail.alertTitle")}
            </Text>
            <Text preset="caption" color={theme.colors.onErrorContainer} style={{ marginTop: theme.spacing[1] }}>
              {t("admin.accidentDetail.vehicleSeverity", {
                vehicle: accident.vehicle_plate ?? t("common.notAvailable"),
                severity: accident.severity ?? t("common.notAvailable"),
              })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[3], flexWrap: "wrap" }}>
          {accident.tier != null ? (
            <StatusBadge label={t("admin.accidents.escalationTier", { tier: accident.tier })} tone={accident.tier <= 1 ? "danger" : "warning"} />
          ) : null}
          <StatusBadge
            label={acknowledged ? t("admin.accidents.acknowledged") : t("admin.accidentDetail.awaitingAck")}
            tone={acknowledged ? "success" : "danger"}
          />
        </View>
      </Card>

      {/* Auto-dispatch countdown */}
      <Card variant="container">
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {t("admin.accidentDetail.autoDispatchLabel")}
        </Text>
        <Text
          preset="metric"
          color={acknowledged ? theme.colors.primary : theme.colors.error}
          style={{ marginTop: theme.spacing[2] }}
        >
          {acknowledged
            ? t("admin.accidentDetail.timerHalted")
            : accident.seconds_to_escalation != null
              ? t("admin.accidents.timeRemaining", { seconds: accident.seconds_to_escalation })
              : t("common.notAvailable")}
        </Text>
        <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
          {t("admin.accidentDetail.acknowledgeHelp")}
        </Text>
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            variant="primary"
            loading={busy}
            disabled={acknowledged}
            onPress={() => void acknowledge()}
            icon={<Icon name="check_circle" size={20} color={theme.colors.onPrimary} />}
            testID="accident-acknowledge"
          >
            {acknowledged ? t("admin.accidents.acknowledged") : t("admin.accidentDetail.acknowledgeAndHalt")}
          </Button>
        </View>
        {acknowledged && accident.acknowledged_by ? (
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
            {t("admin.accidentDetail.acknowledgedBy", {
              user: accident.acknowledged_by,
              at: accident.acknowledged_at ?? t("common.notAvailable"),
            })}
          </Text>
        ) : null}
      </Card>

      {/* Description */}
      <Card variant="container" title={t("admin.accidentDetail.description")}>
        <Text preset="body02">{accident.description ?? t("admin.accidentDetail.noDescription")}</Text>
        <View style={{ marginTop: theme.spacing[4], gap: theme.spacing[3] }}>
          <Field icon="schedule" label={t("admin.accidentDetail.occurredAt")} value={accident.occurred_at} />
          <Field icon="person" label={t("admin.accidentDetail.driver")} value={accident.driver_name} />
          <Field icon="directions_car" label={t("admin.accidentDetail.vehicle")} value={accident.vehicle_plate} />
          <Field
            icon="location_on"
            label={t("admin.accidentDetail.location")}
            value={
              accident.location_text ??
              (accident.latitude != null && accident.longitude != null
                ? `${accident.latitude}, ${accident.longitude}`
                : null)
            }
          />
          <Field
            icon="speed"
            label={t("admin.accidentDetail.speedAtImpact")}
            value={accident.speed_kph != null ? `${accident.speed_kph} ${t("common.km")}/h` : null}
          />
        </View>
      </Card>

      {/* Media gallery */}
      <Card variant="container" title={t("admin.accidentDetail.mediaGallery")}>
        {media.length === 0 ? (
          <EmptyState
            title={t("admin.accidentDetail.noMedia")}
            description={t("admin.accidentDetail.noMediaDescription")}
            icon={<Icon name="camera" size={32} color={theme.colors.outline} />}
          />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3] }}>
            {media.map((m, i) => (
              <View
                key={m.media_object_id ?? i}
                style={{
                  width: 96,
                  height: 96,
                  backgroundColor: theme.colors.surfaceContainerHigh,
                  borderWidth: 1,
                  borderColor: theme.colors.outlineVariant,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {m.uri ? (
                  <Image source={{ uri: m.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <Icon name="image" size={24} color={theme.colors.outline} />
                )}
              </View>
            ))}
          </View>
        )}
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            variant="secondary"
            onPress={onAddMedia ?? (() => undefined)}
            icon={<Icon name="camera" size={20} color={theme.colors.primary} />}
            testID="accident-add-media"
          >
            {t("admin.accidentDetail.addMedia")}
          </Button>
        </View>
      </Card>

      {/* Telemetry chain verification (C3.4) */}
      <Card variant="container" title={t("admin.accidents.verifyChain")}>
        <Text preset="caption" color={theme.colors.onSurfaceVariant}>
          {t("admin.accidentDetail.verifyChainHelp")}
        </Text>
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            variant="secondary"
            onPress={() => void verifyTelemetry()}
            icon={<Icon name="verified_user" size={20} color={theme.colors.primary} />}
            testID="accident-verify-chain"
          >
            {t("admin.accidents.verifyChain")}
          </Button>
        </View>
        {telemetryRows && telemetryRows.length > 0 ? (
          <View style={{ marginTop: theme.spacing[4] }}>
            <StatusBadge
              label={chainValid ? t("admin.accidents.chainValid", { rows: telemetryRows.length }) : t("admin.accidents.chainInvalid")}
              tone={chainValid ? "success" : "danger"}
            />
            <View style={{ marginTop: theme.spacing[3], minHeight: 48 }}>
              <DataTable<TelemetryRow>
                testID="accident-telemetry-table"
                columns={[
                  {
                    key: "label",
                    header: t("admin.accidentDetail.telemetryRowHeader"),
                    flex: 2,
                    render: (r) => <Text preset="body02">{r.label}</Text>,
                  },
                  {
                    key: "valid",
                    header: t("admin.accidentDetail.chainStatus"),
                    flex: 1,
                    align: "right",
                    render: (r) => (
                      <StatusBadge
                        label={r.valid ? t("admin.accidentDetail.rowValid") : t("admin.accidentDetail.rowInvalid")}
                        tone={r.valid ? "success" : "danger"}
                      />
                    ),
                  },
                ]}
                rows={telemetryRows}
              />
            </View>
          </View>
        ) : null}
      </Card>

      {/* Escalation timeline */}
      <Card variant="container" title={t("admin.accidents.timeline")}>
        {timeline.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.accidentDetail.noTimeline")}
          </Text>
        ) : (
          <View style={{ borderLeftWidth: 2, borderLeftColor: theme.colors.outlineVariant, paddingLeft: theme.spacing[4] }}>
            {timeline.map((e, i) => (
              <View key={i} style={{ marginBottom: theme.spacing[5], flexDirection: "row", gap: theme.spacing[3] }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    marginTop: theme.spacing[1],
                    backgroundColor: timelineDotColor(e.state),
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text preset="label" color={e.state === "CURRENT" ? theme.colors.primary : theme.colors.onSurfaceVariant}>
                    {e.at ?? t("common.notAvailable")}
                    {e.tier != null ? ` · ${t("admin.accidents.escalationTier", { tier: e.tier })}` : ""}
                  </Text>
                  <Text preset="bodyStrong" style={{ marginTop: theme.spacing[1] }}>
                    {e.event ?? t("common.notAvailable")}
                  </Text>
                  {e.detail ? (
                    <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                      {e.detail}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* On-call roster */}
      <Card variant="container" title={t("admin.accidents.onCallRoster")}>
        {onCall.length === 0 ? (
          <Text preset="body02" color={theme.colors.onSurfaceVariant}>
            {t("admin.accidentDetail.noOnCall")}
          </Text>
        ) : (
          onCall.map((c, i) => (
            <View
              key={c.user_id ?? i}
              style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing[3],
                paddingVertical: theme.spacing[3],
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.outlineVariant,
              }}
            >
              <Icon name="badge" size={24} color={theme.colors.onSurfaceVariant} />
              <View style={{ flex: 1 }}>
                <Text preset="body02">{c.full_name ?? c.user_id ?? t("common.notAvailable")}</Text>
                <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                  {[c.role, c.phone].filter(Boolean).join(" · ") || t("common.notAvailable")}
                </Text>
              </View>
              {c.notified_at ? (
                <StatusBadge label={t("admin.accidentDetail.notified")} tone="info" />
              ) : (
                <StatusBadge label={t("admin.accidentDetail.notNotified")} tone="neutral" />
              )}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  )
}

function Field({
  icon,
  label,
  value,
}: {
  icon: "schedule" | "person" | "directions_car" | "location_on" | "speed"
  label: string
  value?: string | null
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
      <Icon name={icon} size={20} color={theme.colors.onSurfaceVariant} />
      <View style={{ flex: 1 }}>
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {label}
        </Text>
        <Text preset="body02" style={{ marginTop: theme.spacing[1] }}>
          {value ?? t("common.notAvailable")}
        </Text>
      </View>
    </View>
  )
}
