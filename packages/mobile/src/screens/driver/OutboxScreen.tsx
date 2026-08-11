// packages/mobile/src/screens/driver/OutboxScreen.tsx
//
// Global Offline Outbox (spec `global_outbox_1` / `global_outbox_2`, flows.md D-7). Reads the durable
// offline queue (`services.queue`) and lets the driver resolve writes that have not reached the
// server yet:
//   • a summary strip (total / pending / failed / in-flight) driven by `queue.counts()`
//   • one card per `OutboxItem` with a `StatusBadge` for PENDING / INFLIGHT / FAILED_REVIEW / DONE,
//     the queued-at age, the attempt count and the last error code
//   • per-item Retry (re-arms a FAILED_REVIEW item as PENDING, then runs one drain cycle) and
//     Discard (drops the item — D-7 "user discard")
//   • a global "Flush now" that runs a single `services.drainer.cycle()` pass
//   • an `EmptyState` when the queue is drained
//
// The queue itself is pure logic over a `QueueStore`; this screen never talks to the API directly.
// All copy comes from i18n (D-10).

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Icon, type IconName } from "@/design/components/Icon"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { OutboxItem, OutboxStatus, OutboxCounts } from "@/core/offlineQueue"

export interface OutboxScreenProps {
  services: Services
  /** True when the socket reports a live connection — a flush is pointless while offline. */
  online: boolean
  /** Called after every mutation so the router can refresh its badge count. */
  onCountsChanged?: (counts: OutboxCounts) => void
  onBack: () => void
}

const EMPTY_COUNTS: OutboxCounts = { pending: 0, inflight: 0, failedReview: 0, done: 0, total: 0 }

/** Status → badge tone (Carbon semantic colours). */
function toneFor(status: OutboxStatus): BadgeTone {
  switch (status) {
    case "PENDING":
      return "warning"
    case "INFLIGHT":
      return "info"
    case "FAILED_REVIEW":
      return "danger"
    case "DONE":
      return "success"
  }
}

/** Status → leading icon, mirroring the spec's per-row glyphs. */
function iconFor(status: OutboxStatus): IconName {
  switch (status) {
    case "PENDING":
      return "schedule"
    case "INFLIGHT":
      return "sync"
    case "FAILED_REVIEW":
      return "report_problem"
    case "DONE":
      return "check_circle"
  }
}

function statusLabel(status: OutboxStatus): string {
  switch (status) {
    case "PENDING":
      return t("outbox.statusPending")
    case "INFLIGHT":
      return t("outbox.statusInflight")
    case "FAILED_REVIEW":
      return t("outbox.statusFailedReview")
    case "DONE":
      return t("outbox.statusDone")
  }
}

/** Coarse relative age ("Queued {{when}}"), localized through the shared `driver.outbox.age*` keys. */
function formatAge(iso: string, now: number): string {
  const ms = now - Date.parse(iso)
  if (Number.isNaN(ms)) return t("common.notAvailable")
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return t("driver.outbox.ageJustNow")
  if (minutes < 60) return t("driver.outbox.ageMinutes", { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("driver.outbox.ageHours", { count: hours })
  return t("driver.outbox.ageDays", { count: Math.floor(hours / 24) })
}

/** Fallback title when an item was enqueued without a human label: "POST /shifts". */
function titleFor(item: OutboxItem): string {
  return item.label ?? `${item.method} ${item.path}`
}

/**
 * Localized error text for the item's last error code. `t()` echoes the key back when a code has no
 * entry (D-10 makes gaps loud), so an unmapped code is rendered bare rather than as "errors.XYZ".
 */
function errorText(code: string): string {
  const translated = t(`errors.${code}`)
  return translated === `errors.${code}` ? code : translated
}

export function OutboxScreen({ services, online, onCountsChanged, onBack }: OutboxScreenProps) {
  const [items, setItems] = useState<OutboxItem[]>([])
  const [counts, setCounts] = useState<OutboxCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [flushing, setFlushing] = useState(false)
  const [busyId, setBusyId] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const [list, next] = await Promise.all([services.queue.list(), services.queue.counts()])
      setItems(list)
      setCounts(next)
      setNow(Date.now())
      onCountsChanged?.(next)
    } catch {
      // The store is local — a failure here means the device store is unavailable. Keep the last
      // render and let the empty state speak rather than blanking the screen.
    } finally {
      setLoading(false)
    }
  }, [services, onCountsChanged])

  useEffect(() => {
    void load()
  }, [load])

  /** "Flush now": one serial drain pass over every eligible item, then re-read the queue. */
  const flush = useCallback(async () => {
    setFlushing(true)
    setNotice(undefined)
    try {
      await services.drainer.cycle()
    } catch {
      // A drain failure is already recorded on the items themselves (lastError); just re-read.
    } finally {
      setFlushing(false)
      await load()
    }
  }, [services, load])

  /**
   * Retry one item. A FAILED_REVIEW item is parked outside the drainer's eligible set, so it is
   * first re-armed as PENDING (attempts preserved, last error cleared) and then a drain cycle runs.
   */
  const retry = useCallback(
    async (item: OutboxItem) => {
      setBusyId(item.id)
      setNotice(undefined)
      try {
        if (item.status !== "PENDING" && item.status !== "INFLIGHT") {
          await services.queue.enqueue({
            method: item.method,
            path: item.path,
            body: item.body,
            label: item.label,
            idempotencyKey: item.idempotencyKey,
            now: () => item.queuedAt,
          })
          await services.queue.discard(item.id)
        }
        await services.drainer.cycle()
      } catch {
        // Outcome is reflected in the reloaded item state below.
      } finally {
        setBusyId(undefined)
        await load()
      }
    },
    [services, load],
  )

  const discard = useCallback(
    async (item: OutboxItem) => {
      setBusyId(item.id)
      try {
        await services.queue.discard(item.id)
        setNotice(t("outbox.itemDiscarded"))
      } catch {
        // Nothing to surface: the item stays listed and the driver can try again.
      } finally {
        setBusyId(undefined)
        await load()
      }
    },
    [services, load],
  )

  const summary: { key: string; labelKey: string; value: number; tone: BadgeTone }[] = [
    { key: "total", labelKey: "driver.outbox.totalQueued", value: counts.total, tone: "neutral" },
    { key: "pending", labelKey: "driver.outbox.pendingCount", value: counts.pending, tone: "warning" },
    { key: "failed", labelKey: "driver.outbox.failedCount", value: counts.failedReview, tone: "danger" },
    { key: "inflight", labelKey: "driver.outbox.inflightCount", value: counts.inflight, tone: "info" },
  ]

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="outbox-screen">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="outbox-back"
        />
      </View>

      <Text preset="heading03">{t("outbox.title")}</Text>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("outbox.subtitle")}
      </Text>

      {/* Summary strip — total / pending / failed / in-flight. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -theme.spacing[2] }}>
        {summary.map((s) => (
          <View key={s.key} style={{ width: "50%", padding: theme.spacing[2] }}>
            <Card variant="container" style={{ marginBottom: 0 }} testID={`outbox-count-${s.key}`}>
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t(s.labelKey)}
              </Text>
              <Text preset="heading03" style={{ marginTop: theme.spacing[1] }}>
                {String(s.value)}
              </Text>
            </Card>
          </View>
        ))}
      </View>

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button
          variant="secondary"
          onPress={() => void flush()}
          loading={flushing}
          disabled={!online || counts.total === 0}
          icon={<Icon name="sync" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={flushing ? t("outbox.flushing") : t("outbox.flushNow")}
          testID="outbox-flush"
        />
        {!online ? (
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
            {t("driver.outbox.offlineHint")}
          </Text>
        ) : null}
        {notice ? (
          <Text preset="caption" color={theme.colors.supportSuccess} style={{ marginTop: theme.spacing[2] }}>
            {notice}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[2],
          marginTop: theme.spacing[5],
          marginBottom: theme.spacing[3],
        }}
      >
        <Icon name="list" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {t("driver.outbox.actionQueue")}
        </Text>
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon name="cloud_done" size={32} color={theme.colors.onSurfaceVariant} />}
          title={loading ? t("common.loading") : t("outbox.empty")}
          description={loading ? undefined : t("outbox.emptyDescription")}
          testID="outbox-empty"
        />
      ) : (
        items.map((item) => (
          <Card key={item.id} variant="container" testID={`outbox-item-${item.id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
              <Icon name={iconFor(item.status)} size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
              <StatusBadge label={statusLabel(item.status)} tone={toneFor(item.status)} testID={`outbox-status-${item.id}`} />
              <View style={{ flex: 1 }} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t("outbox.queuedAt", { when: formatAge(item.queuedAt, now) })}
              </Text>
            </View>

            <Text preset="bodyStrong" style={{ marginTop: theme.spacing[3] }}>
              {titleFor(item)}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[3], marginTop: theme.spacing[2] }}>
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t("outbox.attempts", { count: item.attempts })}
              </Text>
              {item.lastError ? (
                <Text preset="caption" color={theme.colors.supportError} testID={`outbox-error-${item.id}`}>
                  {errorText(item.lastError)}
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: "row", gap: theme.spacing[3], marginTop: theme.spacing[4] }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="secondary"
                  onPress={() => void retry(item)}
                  disabled={!online || busyId === item.id}
                  label={t("common.retry")}
                  testID={`outbox-retry-${item.id}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="ghost"
                  onPress={() => void discard(item)}
                  disabled={busyId === item.id}
                  label={t("common.discard")}
                  testID={`outbox-discard-${item.id}`}
                />
              </View>
            </View>
          </Card>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button
          variant="ghost"
          onPress={() => void load()}
          loading={loading}
          label={t("common.pullToRefresh")}
          testID="outbox-refresh"
        />
      </View>
    </ScrollView>
  )
}
