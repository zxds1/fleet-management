// packages/mobile/src/screens/admin/AdminNotificationsScreen.tsx
//
// Admin notifications inbox (spec `admin_notifications`). Pulls the server inbox from
// `GET /notifications` (`services.admin.notifications.load`) and supports marking all as read via
// `PUT /notifications/read`. The socket (connected by `AdminRouter`) keeps the list fresh.

import React, { useCallback, useEffect, useState } from "react"
import { View, ScrollView, TouchableOpacity } from "react-native"
import { theme } from "@/design/theme"
import { Text } from "@/design/components/Text"
import { Button } from "@/design/components/Button"
import { Card } from "@/design/components/Card"
import { Icon } from "@/design/components/Icon"
import { StatusBadge } from "@/design/components/StatusBadge"
import { EmptyState } from "@/design/components/EmptyState"
import { Skeleton } from "@/design/components/Skeleton"
import { t } from "@/core/i18n"
import type { Services } from "@/services"
import type { AdminNotification } from "@/core/admin"

export interface AdminNotificationsScreenProps {
  services: Services
  onBack: () => void
}

export function AdminNotificationsScreen({ services, onBack }: AdminNotificationsScreenProps) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      await services.admin.notifications.load()
      setNotifications([...services.admin.notifications.notifications])
    } finally {
      setLoading(false)
    }
  }, [services])

  useEffect(() => {
    void refresh()
    const off = services.admin.notifications.onChange(() =>
      setNotifications([...services.admin.notifications.notifications]),
    )
    return off
  }, [services, refresh])

  const unread = notifications.filter((n) => n.status !== "DELIVERED").length

  const markAllRead = async () => {
    setBusy(true)
    try {
      await services.admin.notifications.markAllRead()
      setNotifications([...services.admin.notifications.notifications])
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: theme.spacing[5] }} testID="admin-notifications">
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing[4] }}>
        <View style={{ flex: 1, paddingRight: theme.spacing[3] }}>
          <Text preset="heading03">{t("notifications.title")}</Text>
          {unread > 0 ? (
            <View style={{ marginTop: theme.spacing[1] }}>
              <StatusBadge label={`${unread} ${t("notifications.unread")}`} tone="warning" />
            </View>
          ) : null}
        </View>
        <Button variant="ghost" fullWidth={false} onPress={onBack}>
          {t("common.back")}
        </Button>
      </View>

      {loading ? (
        <Card variant="container">
          <Skeleton width="100%" height={20} />
          <View style={{ height: theme.spacing[3] }} />
          <Skeleton width="80%" height={20} />
        </Card>
      ) : notifications.length === 0 ? (
        <EmptyState
          title={t("notifications.empty")}
          description={t("notifications.emptyDescription")}
          icon={<Icon name="notifications_none" size={32} color={theme.colors.outline} />}
        />
      ) : (
        <>
          <View style={{ marginBottom: theme.spacing[3] }}>
            <Button variant="secondary" fullWidth={false} loading={busy} disabled={unread === 0} onPress={markAllRead}>
              {t("notifications.markAllRead")}
            </Button>
          </View>
          {notifications.map((n) => {
            const read = n.status === "DELIVERED"
            return (
              <TouchableOpacity key={n.id} accessibilityRole="button" testID={`admin-notification-${n.id}`}>
                <Card
                  variant="container"
                  style={{ marginBottom: theme.spacing[3], backgroundColor: read ? theme.colors.ui02 : theme.colors.ui01 }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing[2] }}>
                    <Text preset="body02" style={{ fontWeight: read ? "400" : "700", flex: 1 }}>
                      {n.title}
                    </Text>
                    {!read ? <Icon name="circle" size={10} color={theme.colors.primary} /> : null}
                  </View>
                  {n.body ? (
                    <Text variant="caption" color={theme.colors.textSecondary} style={{ marginTop: theme.spacing[2] }}>
                      {n.body}
                    </Text>
                  ) : null}
                </Card>
              </TouchableOpacity>
            )
          })}
        </>
      )}
    </ScrollView>
  )
}
