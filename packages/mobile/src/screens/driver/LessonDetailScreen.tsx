// packages/mobile/src/screens/driver/LessonDetailScreen.tsx
//
// Driver lesson detail (spec `lesson_detail`). Loads one lesson via
// `services.training.getLesson(id)` and lets the driver record their own completion with
// `services.training.completeLesson(id)` (`POST /training/lessons/{id}/complete`, `training:complete`).
//
// The server resolves the completing driver from the authenticated principal, never from the body,
// so this screen never sends a driver id. On success the parent is notified via `onCompleted` so
// the hub's completion set stays consistent without a second round-trip.
//
// States covered (flows.md §D): loading skeleton, load error, not-found, data, submitting (primary
// button spinner + disabled), completed.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView, Linking } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { TrainingLesson } from "@/core/driver/training"

export interface LessonDetailScreenProps {
  services: Services
  lessonId: string
  /** True when the driver already completed this lesson (router-owned completion set). */
  completed: boolean
  /** Called after a successful completion so the router can mark the lesson done. */
  onCompleted: (lessonId: string) => void
  onBack: () => void
}

function formatWhen(iso?: string | null): string {
  if (!iso) return t("common.notAvailable")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? t("common.notAvailable") : d.toLocaleDateString()
}

export function LessonDetailScreen({
  services,
  lessonId,
  completed,
  onCompleted,
  onBack,
}: LessonDetailScreenProps) {
  const [lesson, setLesson] = useState<TrainingLesson | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<AppError>()
  /** Locally-known completion: either the router already knew, or we just recorded it. */
  const [done, setDone] = useState(completed)
  const [completedAt, setCompletedAt] = useState<string | null>(null)
  const [quizScore, setQuizScore] = useState<number | null>(null)

  useEffect(() => {
    setDone(completed)
  }, [completed])

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setLesson(await services.training.getLesson(lessonId))
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services, lessonId])

  useEffect(() => {
    void load()
  }, [load])

  const markComplete = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(undefined)
    try {
      const enrollment = await services.training.completeLesson(lessonId)
      setDone(true)
      setCompletedAt(enrollment.completed_at ?? new Date().toISOString())
      setQuizScore(enrollment.quiz_score ?? null)
      onCompleted(lessonId)
    } catch (e) {
      setSubmitError(fromUnknown(e))
    } finally {
      setSubmitting(false)
    }
  }, [services, lessonId, onCompleted])

  const openContent = useCallback(() => {
    const url = lesson?.content_url
    if (!url) return
    // Fire-and-forget: an unopenable URL must not break the lesson screen.
    void Linking.openURL(url).catch(() => undefined)
  }, [lesson?.content_url])

  const backButton = (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
      <Button
        variant="ghost"
        fullWidth={false}
        onPress={onBack}
        icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
        label={t("driver.training.lesson.backToCourse")}
        testID="lesson-detail-back"
      />
    </View>
  )

  if (loading) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-lesson-detail">
        {backButton}
        <Card variant="container" testID="lesson-detail-loading">
          <Skeleton width="70%" height={24} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="100%" height={16} />
          <View style={{ height: theme.spacing[2] }} />
          <Skeleton width="90%" height={16} />
          <View style={{ height: theme.spacing[4] }} />
          <Skeleton width="100%" height={120} />
        </Card>
      </ScrollView>
    )
  }

  if (!lesson) {
    return (
      <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-lesson-detail">
        {backButton}
        {error ? (
          <View style={{ marginBottom: theme.spacing[4] }}>
            <ErrorState error={error} onAction={() => void load()} testID="lesson-detail-error" />
          </View>
        ) : null}
        <EmptyState
          icon={<Icon name="school" size={32} color={theme.colors.onSurfaceVariant} />}
          title={error ? t("driver.training.lesson.loadError") : t("driver.training.lesson.notFound")}
          description={error ? undefined : t("driver.training.lesson.notFoundDescription")}
          actionLabel={t("driver.training.hub.refresh")}
          onAction={() => void load()}
          testID="lesson-detail-empty"
        />
      </ScrollView>
    )
  }

  const courseLabel = [lesson.course_code, lesson.course_title].filter(Boolean).join(" · ")

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-lesson-detail">
      {backButton}

      {/* Header: course context, title, description, duration + status. */}
      <Text preset="label" color={theme.colors.onSurfaceVariant} style={{ textTransform: "uppercase" }}>
        {courseLabel || t("driver.training.lesson.lessonCode", { code: lesson.code })}
      </Text>
      <Text preset="heading03" style={{ marginTop: theme.spacing[2] }}>
        {lesson.title}
      </Text>
      <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
        {lesson.description ?? t("driver.training.lesson.noDescription")}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing[3],
          marginTop: theme.spacing[3],
          marginBottom: theme.spacing[4],
        }}
      >
        <StatusBadge
          label={done ? t("driver.training.status.COMPLETED") : t("driver.training.status.NOT_STARTED")}
          tone={done ? "success" : "neutral"}
          testID="lesson-detail-status"
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[1] }}>
          <Icon name="schedule" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
          <Text preset="caption" color={theme.colors.onSurfaceVariant}>
            {lesson.duration_minutes != null && lesson.duration_minutes > 0
              ? t("driver.training.hub.duration", { minutes: lesson.duration_minutes })
              : t("driver.training.hub.durationUnknown")}
          </Text>
        </View>
        {lesson.is_mandatory ? (
          <StatusBadge label={t("driver.training.hub.mandatory")} tone="warning" />
        ) : null}
      </View>

      {/* Content area: the lesson material (spec's video/article canvas). */}
      <Card variant="container" testID="lesson-detail-content">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
          <Icon name="menu_book" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="heading01">{t("driver.training.lesson.content")}</Text>
        </View>
        <Text preset="body02" color={theme.colors.onSurfaceVariant}>
          {t("driver.training.lesson.contentPlaceholder")}
        </Text>
        <View style={{ marginTop: theme.spacing[4] }}>
          {lesson.content_url ? (
            <Button
              variant="secondary"
              onPress={openContent}
              label={t("driver.training.lesson.openContent")}
              icon={<Icon name="play_circle" size={theme.sizing.iconMd} color={theme.colors.primary} />}
              testID="lesson-detail-open-content"
            />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
              <Icon name="info" size={theme.sizing.iconSm} color={theme.colors.onSurfaceVariant} />
              <Text preset="caption" color={theme.colors.onSurfaceVariant}>
                {t("driver.training.lesson.noContent")}
              </Text>
            </View>
          )}
        </View>
      </Card>

      {/* Key takeaway (spec's bento aside). */}
      <Card variant="surface" testID="lesson-detail-takeaway">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[2] }}>
          <Icon name="star" size={theme.sizing.iconMd} color={theme.colors.primary} />
          <Text preset="bodyStrong">{t("driver.training.lesson.keyTakeaway")}</Text>
        </View>
        <Text preset="caption" color={theme.colors.onSurfaceVariant}>
          {t("driver.training.lesson.keyTakeawayBody")}
        </Text>
      </Card>

      {submitError ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={submitError} onAction={() => void markComplete()} testID="lesson-detail-submit-error" />
        </View>
      ) : null}

      {/* Primary action / completed confirmation. */}
      {done ? (
        <Card variant="container" accent={theme.colors.success} testID="lesson-detail-completed">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
            <Icon name="check_circle" size={theme.sizing.iconLg} color={theme.colors.success} />
            <View style={{ flex: 1 }}>
              <Text preset="bodyStrong">{t("driver.training.lesson.completed")}</Text>
              {completedAt ? (
                <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                  {t("driver.training.lesson.completedOn", { date: formatWhen(completedAt) })}
                </Text>
              ) : null}
              {quizScore != null ? (
                <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                  {t("driver.training.lesson.quizScore", { score: quizScore })}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      ) : (
        <Button
          onPress={() => void markComplete()}
          loading={submitting}
          label={submitting ? t("driver.training.lesson.completing") : t("driver.training.lesson.markComplete")}
          icon={<Icon name="check" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
          testID="lesson-detail-complete"
        />
      )}
    </ScrollView>
  )
}
