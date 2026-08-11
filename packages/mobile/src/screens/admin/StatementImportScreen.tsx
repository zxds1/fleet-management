// packages/mobile/src/screens/admin/StatementImportScreen.tsx
//
// C.12 Statement Import. Pick a provider CSV → `POST /reconciliation/statements`; the server parses
// and matches asynchronously, so this screen renders the reported stage/detail while it runs and
// then lists the per-file outcome (matched / errored) as a result list.
//
// No dedicated spec HTML exists for this screen; it follows the design system and the Fuel
// reconciliation visual language (squared cards, gray10 container, severity accents).

import React from "react"
import { View, ScrollView, ActivityIndicator } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { t } from "@/core/i18n"

/** Async progress reported by the statement-matching job. */
export interface StatementImportProgress {
  /** `UPLOADING` | `PARSING` | `MATCHING` | `DONE` | `FAILED` — free-form, echoed from the server. */
  stage?: string | null
  detail?: string | null
}

export interface StatementImportResult {
  file?: string | null
  /** `MATCHED` | `PARTIAL` | `ERROR` | `SKIPPED` */
  status?: string | null
  message?: string | null
}

export interface StatementImportScreenProps {
  onPickFile: () => void
  progress?: StatementImportProgress
  results?: StatementImportResult[]
  onBack: () => void
}

function resultTone(status?: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "MATCHED") return "success"
  if (status === "PARTIAL") return "warning"
  if (status === "ERROR") return "danger"
  return "neutral"
}

function resultAccent(status?: string | null): string {
  if (status === "MATCHED") return theme.colors.supportSuccess
  if (status === "PARTIAL") return theme.colors.supportWarning
  if (status === "ERROR") return theme.colors.supportError
  return theme.colors.outlineVariant
}

export function StatementImportScreen({ onPickFile, progress, results, onBack }: StatementImportScreenProps) {
  const rows = results ?? []
  const stage = progress?.stage ?? null
  const running = stage != null && stage !== "DONE" && stage !== "FAILED"

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-statement-import">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3], flex: 1 }}>
          <Icon name="arrow_back" size={24} color={theme.colors.primary} />
          <Text preset="heading03" numberOfLines={1}>
            {t("admin.statementImport.title")}
          </Text>
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {/* File picker */}
      <Card variant="container" title={t("admin.statementImport.pickFileTitle")}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] }}>
          <Icon name="description" size={24} color={theme.colors.primary} />
          <Text preset="body02" color={theme.colors.onSurfaceVariant} style={{ flex: 1 }}>
            {t("admin.statementImport.pickFileHelp")}
          </Text>
        </View>
        <View style={{ marginTop: theme.spacing[4] }}>
          <Button
            variant="primary"
            disabled={running}
            onPress={onPickFile}
            icon={<Icon name="add" size={20} color={theme.colors.onPrimary} />}
            testID="statement-pick-file"
          >
            {t("admin.statementImport.chooseCsv")}
          </Button>
        </View>
      </Card>

      {/* Async progress */}
      {progress ? (
        <Card
          variant="container"
          title={t("admin.statementImport.progress")}
          accent={stage === "FAILED" ? theme.colors.supportError : stage === "DONE" ? theme.colors.supportSuccess : theme.colors.primary}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[3] }}>
            {running ? (
              <ActivityIndicator color={theme.colors.primary} size="small" />
            ) : (
              <Icon
                name={stage === "FAILED" ? "warning" : "check_circle"}
                size={24}
                color={stage === "FAILED" ? theme.colors.error : theme.colors.success}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text preset="bodyStrong">{stage ?? t("common.loading")}</Text>
              {progress.detail ? (
                <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[1] }}>
                  {progress.detail}
                </Text>
              ) : null}
            </View>
            <StatusBadge
              label={running ? t("common.pending") : stage === "FAILED" ? t("admin.statementImport.failed") : t("common.statusCompleted")}
              tone={running ? "info" : stage === "FAILED" ? "danger" : "success"}
            />
          </View>
          {running ? (
            <Text preset="caption" color={theme.colors.onSurfaceVariant} style={{ marginTop: theme.spacing[3] }}>
              {t("admin.statementImport.asyncNote")}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Results */}
      <Card variant="container" title={t("admin.statementImport.results")}>
        {rows.length === 0 ? (
          <EmptyState
            title={t("admin.statementImport.noResults")}
            description={t("admin.statementImport.noResultsDescription")}
            icon={<Icon name="list" size={32} color={theme.colors.outline} />}
          />
        ) : (
          rows.map((r, i) => (
            <Card
              key={`${r.file ?? "file"}-${i}`}
              variant="surface"
              accent={resultAccent(r.status)}
              style={{ marginBottom: theme.spacing[3] }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing[3] }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2], flex: 1 }}>
                  <Icon
                    name={r.status === "ERROR" ? "warning" : "check_circle"}
                    size={20}
                    color={r.status === "ERROR" ? theme.colors.error : theme.colors.success}
                  />
                  <Text preset="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                    {r.file ?? t("common.notAvailable")}
                  </Text>
                </View>
                <StatusBadge label={r.status ?? t("common.notAvailable")} tone={resultTone(r.status)} />
              </View>
              {r.message ? (
                <Text
                  preset="body02"
                  color={r.status === "ERROR" ? theme.colors.error : theme.colors.onSurfaceVariant}
                  style={{ marginTop: theme.spacing[3] }}
                >
                  {r.message}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </Card>
    </ScrollView>
  )
}
