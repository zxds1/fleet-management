// packages/mobile/src/screens/admin/TrainingReviewScreen.tsx
//
// Training & compliance review (spec `training_compliance_review`). Lists published lessons from
// `GET /training/lessons` with completion ratios derived from the roster (`GET /training/roster`).
// A lesson row opens a bottom sheet listing the per-driver enrolments (status, score, completed_at).
// The "nudge" action re-marks the *calling* driver's enrolment complete via `completeLesson`.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { BottomSheet } from "@/design/components/BottomSheet"
import { DataTable, type DataTableColumn } from "@/design/components/DataTable"
import { Progress } from "@/design/components/Progress"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { TrainingLesson, TrainingRosterRow } from "@/core/admin"

export interface TrainingReviewScreenProps {
  services: Services
  onBack: () => void
}

function completionTone(ratio: number): BadgeTone {
  if (ratio >= 0.9) return "success"
  if (ratio >= 0.6) return "info"
  if (ratio >= 0.3) return "warning"
  return "danger"
}

export function TrainingReviewScreen({ services, onBack }: TrainingReviewScreenProps) {
  const [lessons, setLessons] = useState<TrainingLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [active, setActive] = useState<TrainingLesson | null>(null)
  const [roster, setRoster] = useState<TrainingRosterRow[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [nudgeBusy, setNudgeBusy] = useState(false)
  const [nudgeDone, setNudgeDone] = useState(false)

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      await services.admin.training.load()
      setLessons([...services.admin.training.lessons])
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
    const off = services.admin.training.onChange(() => setLessons([...services.admin.training.lessons]))
    return off
  }, [services, refresh])

  const openLesson = (lesson: TrainingLesson) => {
    setActive(lesson)
    setRosterLoading(true)
    setNudgeDone(false)
    const rows = services.admin.training.roster.filter((r) => r.lesson_id === lesson.id)
    setRoster(rows)
    setRosterLoading(false)
  }

  const nudge = async () => {
    if (!active) return
    setNudgeBusy(true)
    try {
      await services.admin.training.completeLesson(active.id)
      setNudgeDone(true)
    } finally {
      setNudgeBusy(false)
    }
  }

  const rosterColumns: DataTableColumn<TrainingRosterRow>[] = [
    {
      key: "driver",
      header: t("admin.training.colDriver"),
      flex: 2,
      render: (r) => <Text preset="bodyStrong">{r.driver_name ?? t("common.notAvailable")}</Text>,
    },
    {
      key: "status",
      header: t("admin.training.colStatus"),
      flex: 1.2,
      render: (r) => (
        <StatusBadge
          label={r.status === "COMPLETED" ? t("admin.training.completed") : t("admin.training.pending")}
          tone={r.status === "COMPLETED" ? "success" : "warning"}
        />
      ),
    },
    {
      key: "score",
      header: t("admin.training.colScore"),
      flex: 1,
      align: "right",
      render: (r) => <Text preset="body02">{r.quiz_score != null ? `${r.quiz_score}%` : t("common.notAvailable")}</Text>,
    },
    {
      key: "completed",
      header: t("admin.training.colCompleted"),
      flex: 1.5,
      render: (r) => (
        <Text preset="caption" color={theme.colors.textSecondary}>
          {r.completed_at ? r.completed_at.slice(0, 10) : t("admin.training.notYet")}
        </Text>
      ),
    },
  ]

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-training">
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing[4],
        }}
      >
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{t("admin.training.title")}</Text>
          <Text preset="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[1] }}>
            {t("admin.training.subtitle")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {error ? (
        <ErrorState error={error} onAction={() => void refresh()} />
      ) : null}

      {loading ? (
        <Card variant="container">
          <Skeleton width="100%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="90%" height={20} />
        </Card>
      ) : lessons.length === 0 ? (
        <EmptyState
          title={t("admin.training.empty")}
          description={t("admin.training.emptyDescription")}
          icon={<Icon name="school" size={32} color={theme.colors.outline} />}
        />
      ) : (
        lessons.map((lesson) => {
          const c = services.admin.training.completionFor(lesson.id)
          const pct = Math.round(c.ratio * 100)
          return (
            <Card
              key={lesson.id}
              variant="container"
              testID={`training-lesson-${lesson.id}`}
              onPress={() => openLesson(lesson)}
              accessibilityLabel={lesson.title}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
                <Icon name="school" size={theme.sizing.iconLg} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text preset="heading01">{lesson.title}</Text>
                  <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                    {[lesson.course_code, lesson.course_title].filter(Boolean).join(" · ") || t("common.notAvailable")}
                    {lesson.is_mandatory ? ` · ${t("admin.training.mandatory")}` : ""}
                  </Text>
                  <View style={{ marginTop: theme.spacing[3] }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: theme.spacing[1] }}>
                      <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                        {t("admin.training.completion")}
                      </Text>
                      <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                        {pct}% · {c.completed}/{c.total}
                      </Text>
                    </View>
                    <Progress value={c.ratio} tone={completionTone(c.ratio)} />
                  </View>
                </View>
                <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.outline} />
              </View>
            </Card>
          )
        })
      )}

      <BottomSheet
        open={active != null}
        onClose={() => setActive(null)}
        title={active?.title ?? t("admin.training.title")}
        centered={theme.isTablet}
      >
        <ScrollView>
          <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[4] }}>
            {t("admin.training.rosterHelp")}
          </Text>
          {rosterLoading ? (
            <Skeleton width="100%" height={160} />
          ) : roster.length === 0 ? (
            <EmptyState title={t("admin.training.rosterEmpty")} icon={<Icon name="people" size={28} color={theme.colors.outline} />} />
          ) : (
            <Card variant="container" style={{ padding: 0 }}>
              <DataTable testID="training-roster" columns={rosterColumns} rows={roster} />
            </Card>
          )}
          <View style={{ marginTop: theme.spacing[4] }}>
            <Button
              variant="primary"
              loading={nudgeBusy}
              disabled={nudgeDone}
              onPress={nudge}
              testID="training-nudge"
              label={nudgeDone ? t("admin.training.nudged") : t("admin.training.nudge")}
              icon={
                nudgeDone ? (
                  <Icon name="check" size={theme.sizing.iconMd} color={theme.colors.textOnColor} />
                ) : (
                  <Icon name="campaign" size={theme.sizing.iconMd} color={theme.colors.textOnColor} />
                )
              }
            />
          </View>
        </ScrollView>
      </BottomSheet>
    </ScrollView>
  )
}
