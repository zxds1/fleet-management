// packages/mobile/src/screens/driver/TrainingHubScreen.tsx
//
// Driver training hub (spec `training_hub`). Lists the published lesson catalogue
// (`GET /training/lessons` via `services.training.listLessons()`) grouped by course, with a
// per-lesson completion badge and a Start / Open / Review action that opens the lesson detail.
//
// Completion state: the catalogue endpoint is course-scoped and does NOT carry the calling
// driver's enrolment (only `GET /training/roster`, which is `training:review`, does — a driver
// cannot read it). So the hub renders completion from the set of lessons this session has
// completed, owned by the router and threaded in via `completed`. Anything not in that set renders
// as "not started" — an honest, never-optimistic default.
//
// Presentational + self-fetching: data comes from the injected services, navigation from the
// router. All copy via i18n (D-10).

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, ScrollView } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge, type BadgeTone } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { Progress } from "@/design/components/Progress"
import { Icon } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { TrainingLesson } from "@/core/driver/training"

export interface TrainingHubScreenProps {
  services: Services
  /** Display name for the hero greeting (the router already resolves it for the home hub). */
  driverName: string
  /** Lesson ids the driver has completed in this session (router-owned). */
  completed: ReadonlySet<string>
  onOpenLesson: (lessonId: string) => void
  onOpenResources: () => void
  onBack: () => void
}

/** One course section of the hub: the course heading plus its lessons in `order_index` order. */
interface CourseGroup {
  courseId: string
  title: string
  code: string | null
  mandatory: boolean
  lessons: TrainingLesson[]
}

/**
 * Group the flat catalogue by `course_id`, preserving the server's `(order_index, id)` ordering
 * both between courses (first appearance wins) and inside each course.
 */
export function groupByCourse(lessons: readonly TrainingLesson[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>()
  for (const lesson of lessons) {
    const existing = groups.get(lesson.course_id)
    if (existing) {
      existing.lessons.push(lesson)
      continue
    }
    groups.set(lesson.course_id, {
      courseId: lesson.course_id,
      title: lesson.course_title ?? lesson.course_code ?? t("driver.training.resource.uncategorised"),
      code: lesson.course_code ?? null,
      mandatory: lesson.is_mandatory === true,
      lessons: [lesson],
    })
  }
  return [...groups.values()]
}

function progressTone(ratio: number): BadgeTone {
  if (ratio >= 1) return "success"
  if (ratio > 0) return "info"
  return "neutral"
}

function durationLabel(minutes: number | null | undefined): string {
  return minutes != null && minutes > 0
    ? t("driver.training.hub.duration", { minutes })
    : t("driver.training.hub.durationUnknown")
}

export function TrainingHubScreen({
  services,
  driverName,
  completed,
  onOpenLesson,
  onOpenResources,
  onBack,
}: TrainingHubScreenProps) {
  const [lessons, setLessons] = useState<TrainingLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setLessons(await services.training.listLessons())
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => groupByCourse(lessons), [lessons])
  const total = lessons.length
  const doneCount = useMemo(() => lessons.filter((l) => completed.has(l.id)).length, [lessons, completed])
  const ratio = total > 0 ? doneCount / total : 0
  const percent = Math.round(ratio * 100)
  const outstanding = total - doneCount
  /** The lesson "Resume training" jumps to: the first one that is not yet complete. */
  const nextLesson = useMemo(() => lessons.find((l) => !completed.has(l.id)), [lessons, completed])

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-training-hub">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="training-hub-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Icon name="school" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.training.hub.title")}</Text>
      </View>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.training.hub.subtitle")}
      </Text>

      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="training-hub-error" />
        </View>
      ) : null}

      {/* Hero: greeting + outstanding count + resume CTA (spec "Welcome back"). */}
      <Card variant="container" accent={theme.colors.primary} testID="training-hub-hero">
        <Text preset="heading02">{t("driver.training.hub.welcome", { name: driverName })}</Text>
        <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[2] }}>
          {outstanding > 0
            ? t("driver.training.hub.dueThisWeek", { count: outstanding })
            : t("driver.training.hub.allDone")}
        </Text>
        {nextLesson ? (
          <View style={{ marginTop: theme.spacing[4] }}>
            <Button
              onPress={() => onOpenLesson(nextLesson.id)}
              label={t("driver.training.hub.resumeTraining")}
              icon={<Icon name="play_circle" size={theme.sizing.iconMd} color={theme.colors.onPrimary} />}
              testID="training-hub-resume"
            />
          </View>
        ) : null}
      </Card>

      {/* Overall progress (spec "Overall Progress" bento). */}
      <Card variant="container" testID="training-hub-progress">
        <Text preset="label" color={theme.colors.onSurfaceVariant} style={{ textTransform: "uppercase" }}>
          {t("driver.training.hub.overallProgress")}
        </Text>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: theme.spacing[2],
            marginBottom: theme.spacing[2],
          }}
        >
          <Text preset="heading02">{t("driver.training.hub.progressCount", { completed: doneCount, total })}</Text>
          <Text preset="label" color={theme.colors.primary}>
            {t("driver.training.hub.progressPercent", { percent })}
          </Text>
        </View>
        <Progress value={ratio} tone={progressTone(ratio)} testID="training-hub-progress-bar" />
      </Card>

      <Button
        variant="secondary"
        onPress={onOpenResources}
        label={t("driver.training.hub.openLibrary")}
        icon={<Icon name="menu_book" size={theme.sizing.iconMd} color={theme.colors.primary} />}
        testID="training-hub-open-library"
        style={{ marginBottom: theme.spacing[5] }}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], marginBottom: theme.spacing[3] }}>
        <Icon name="list" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />
        <Text preset="label" color={theme.colors.onSurfaceVariant}>
          {t("driver.training.hub.assignedLessons")}
        </Text>
      </View>

      {loading ? (
        <Card variant="container" testID="training-hub-loading">
          <Skeleton width="60%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="100%" height={16} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="85%" height={16} />
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Icon name="school" size={32} color={theme.colors.onSurfaceVariant} />}
          title={error ? t("driver.training.hub.loadError") : t("driver.training.hub.empty")}
          description={error ? undefined : t("driver.training.hub.emptyDescription")}
          actionLabel={t("driver.training.hub.refresh")}
          onAction={() => void load()}
          testID="training-hub-empty"
        />
      ) : (
        groups.map((group) => {
          const groupDone = group.lessons.filter((l) => completed.has(l.id)).length
          return (
            <Card
              key={group.courseId}
              variant="container"
              style={{ padding: 0 }}
              testID={`training-course-${group.courseId}`}
            >
              <View style={{ padding: theme.spacing[4] }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing[3] }}>
                  <View style={{ flex: 1 }}>
                    <Text preset="heading01">{group.title}</Text>
                    <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                      {[group.code, t("driver.training.hub.lessonCount", { count: group.lessons.length })]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  <StatusBadge
                    label={
                      group.mandatory ? t("driver.training.hub.mandatory") : t("driver.training.hub.optional")
                    }
                    tone={group.mandatory ? "warning" : "neutral"}
                  />
                </View>
                <View style={{ marginTop: theme.spacing[3] }}>
                  <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginBottom: theme.spacing[1] }}>
                    {t("driver.training.hub.courseProgress", { completed: groupDone, total: group.lessons.length })}
                  </Text>
                  <Progress
                    value={group.lessons.length > 0 ? groupDone / group.lessons.length : 0}
                    tone={progressTone(group.lessons.length > 0 ? groupDone / group.lessons.length : 0)}
                  />
                </View>
              </View>

              {group.lessons.map((lesson) => {
                const isDone = completed.has(lesson.id)
                return (
                  <ListRow
                    key={lesson.id}
                    title={lesson.title}
                    subtitle={durationLabel(lesson.duration_minutes)}
                    onPress={() => onOpenLesson(lesson.id)}
                    testID={`training-lesson-${lesson.id}`}
                    trailing={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                        <StatusBadge
                          label={
                            isDone
                              ? t("driver.training.status.COMPLETED")
                              : t("driver.training.status.NOT_STARTED")
                          }
                          tone={isDone ? "success" : "neutral"}
                        />
                        <Text preset="label" color={theme.colors.primary}>
                          {isDone ? t("driver.training.hub.review") : t("driver.training.hub.start")}
                        </Text>
                        <Icon name="chevron_right" size={theme.sizing.iconMd} color={theme.colors.primary} />
                      </View>
                    }
                  />
                )
              })}
            </Card>
          )
        })
      )}
    </ScrollView>
  )
}
