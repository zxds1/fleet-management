// packages/mobile/src/screens/driver/NotificationsScreen.tsx
import React from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { EmptyState } from "@/design/components/EmptyState"
import { theme } from "@/design/theme"
import { t } from "@/core/i18n"
import type { Notification } from "@/core/driver/feed"

export interface NotificationsScreenProps {
  notifications: Notification[]
  onMarkRead: (id: string) => void
  onMarkAll: () => void
  onBack: () => void
}

export function NotificationsScreen({ notifications, onMarkRead, onMarkAll, onBack }: NotificationsScreenProps) {
  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="notifications-screen">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <Text preset="heading03">{t("notifications.title")}</Text>
        <Button variant="ghost" onPress={onMarkAll} disabled={notifications.length === 0}>
          {t("notifications.markAllRead")}
        </Button>
      </View>

      {notifications.length === 0 ? (
        <EmptyState title={t("notifications.empty")} description={t("notifications.emptyDescription")} />
      ) : (
        notifications.map((n) => (
          <TouchableOpacity key={n.id} accessibilityRole="button" onPress={() => onMarkRead(n.id)} testID={`notification-${n.id}`}>
            <Card style={{ marginBottom: theme.spacing[3], backgroundColor: n.read ? theme.colors.ui02 : theme.colors.ui01 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.interactive01, marginRight: theme.spacing[2] }} />}
                <Text preset="body02" style={{ fontWeight: n.read ? "400" : "700" }}>
                  {n.title}
                </Text>
              </View>
              {n.body ? <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>{n.body}</Text> : null}
              <Text style={{ ...theme.textStyle.label01, color: theme.colors.textSecondary, marginTop: theme.spacing[2] }}>
                {new Date(n.created_at).toLocaleString()}
              </Text>
            </Card>
          </TouchableOpacity>
        ))
      )}

      <View style={{ marginTop: theme.spacing[4] }}>
        <Button variant="ghost" onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>
    </ScrollView>
  )
}
