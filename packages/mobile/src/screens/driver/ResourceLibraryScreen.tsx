// packages/mobile/src/screens/driver/ResourceLibraryScreen.tsx
//
// Driver resource library (spec `resource_library`). There is no dedicated backend resource
// endpoint in the frozen contract, so the library is derived from the training catalogue: every
// published lesson is a reference item, and the ones carrying a `content_url` are openable
// (`services.training.listResources()` performs the projection, see core/driver/training.ts).
//
// Search filters client-side over title / description / category — the catalogue is small and
// bounded, and `GET /training/lessons` has no query filter, so a round-trip per keystroke would
// buy nothing.
//
// States covered (flows.md §D): loading skeleton, load error, empty catalogue, empty search
// result, data.

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { View, ScrollView, Linking } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Input } from "@/design/components/Input"
import { ListRow } from "@/design/components/ListRow"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { ErrorState } from "@/design/components/ErrorState"
import { Skeleton } from "@/design/components/Skeleton"
import { Icon, type IconName } from "@/design/components/Icon"
import { t } from "@/core/i18n"
import { fromUnknown, type AppError } from "@/core/error"
import type { Services } from "@/services"
import type { TrainingResource, TrainingResourceKind } from "@/core/driver/training"

export interface ResourceLibraryScreenProps {
  services: Services
  /** Opens the underlying lesson when a resource has no attached file. */
  onOpenLesson: (lessonId: string) => void
  onBack: () => void
}

const KIND_ICON: Record<TrainingResourceKind, IconName> = {
  document: "description",
  video: "play_circle",
  link: "menu_book",
}

/** Case-insensitive substring match across the fields a driver would search on. */
export function matchesQuery(resource: TrainingResource, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [resource.title, resource.description, resource.category]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(q))
}

/** Group resources under their course/category heading, preserving catalogue order. */
export function groupByCategory(resources: readonly TrainingResource[]): { category: string; items: TrainingResource[] }[] {
  const groups = new Map<string, TrainingResource[]>()
  for (const r of resources) {
    const key = r.category ?? t("driver.training.resource.uncategorised")
    const existing = groups.get(key)
    if (existing) existing.push(r)
    else groups.set(key, [r])
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}

export function ResourceLibraryScreen({ services, onOpenLesson, onBack }: ResourceLibraryScreenProps) {
  const [resources, setResources] = useState<TrainingResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AppError>()
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setResources(await services.training.listResources())
    } catch (e) {
      setError(fromUnknown(e))
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => resources.filter((r) => matchesQuery(r, query)), [resources, query])
  const groups = useMemo(() => groupByCategory(filtered), [filtered])

  const open = useCallback(
    (resource: TrainingResource) => {
      // A resource with a file opens it; one without falls back to its lesson, which is the only
      // place the material can be reached from.
      if (resource.url) {
        void Linking.openURL(resource.url).catch(() => undefined)
        return
      }
      onOpenLesson(resource.id)
    },
    [onOpenLesson],
  )

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="driver-resource-library">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: theme.spacing[3] }}>
        <Button
          variant="ghost"
          fullWidth={false}
          onPress={onBack}
          icon={<Icon name="arrow_back" size={theme.sizing.iconMd} color={theme.colors.primary} />}
          label={t("common.back")}
          testID="resource-library-back"
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
        <Icon name="menu_book" size={theme.sizing.iconLg} color={theme.colors.primary} />
        <Text preset="heading03">{t("driver.training.resource.title")}</Text>
      </View>
      <Text
        preset="body02"
        color={theme.colors.onSurfaceVariant}
        style={{ marginTop: theme.spacing[2], marginBottom: theme.spacing[4] }}
      >
        {t("driver.training.resource.subtitle")}
      </Text>

      <Input
        label={t("common.search")}
        placeholder={t("driver.training.resource.search")}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        testID="resource-library-search"
        trailing={<Icon name="search" size={theme.sizing.iconMd} color={theme.colors.onSurfaceVariant} />}
      />

      {error ? (
        <View style={{ marginBottom: theme.spacing[4] }}>
          <ErrorState error={error} onAction={() => void load()} testID="resource-library-error" />
        </View>
      ) : null}

      {loading ? (
        <Card variant="container" testID="resource-library-loading">
          <Skeleton width="50%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="100%" height={16} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="90%" height={16} />
        </Card>
      ) : resources.length === 0 ? (
        <EmptyState
          icon={<Icon name="menu_book" size={32} color={theme.colors.onSurfaceVariant} />}
          title={error ? t("driver.training.resource.loadError") : t("driver.training.resource.empty")}
          description={error ? undefined : t("driver.training.resource.emptyDescription")}
          actionLabel={t("driver.training.hub.refresh")}
          onAction={() => void load()}
          testID="resource-library-empty"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={32} color={theme.colors.onSurfaceVariant} />}
          title={t("driver.training.resource.noResults")}
          description={t("driver.training.resource.noResultsDescription")}
          actionLabel={t("driver.training.resource.clearSearch")}
          onAction={() => setQuery("")}
          testID="resource-library-no-results"
        />
      ) : (
        groups.map((group) => (
          <Card key={group.category} variant="container" style={{ padding: 0 }} testID={`resource-group-${group.category}`}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing[2],
                paddingHorizontal: theme.spacing[5],
                paddingVertical: theme.spacing[3],
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.ui03,
              }}
            >
              <Icon name="category" size={theme.sizing.iconMd} color={theme.colors.primary} />
              <Text preset="label" color={theme.colors.onSurfaceVariant} style={{ textTransform: "uppercase" }}>
                {group.category}
              </Text>
            </View>
            {group.items.map((resource) => (
              <ListRow
                key={resource.id}
                title={resource.title}
                subtitle={resource.description ?? t(`driver.training.resource.kind.${resource.kind}`)}
                onPress={() => open(resource)}
                testID={`resource-${resource.id}`}
                trailing={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                    <StatusBadge
                      label={
                        resource.url
                          ? t(`driver.training.resource.kind.${resource.kind}`)
                          : t("driver.training.resource.unavailable")
                      }
                      tone={resource.url ? "info" : "neutral"}
                    />
                    <Icon
                      name={resource.url ? KIND_ICON[resource.kind] : "chevron_right"}
                      size={theme.sizing.iconMd}
                      color={theme.colors.primary}
                    />
                  </View>
                }
              />
            ))}
          </Card>
        ))
      )}
    </ScrollView>
  )
}
