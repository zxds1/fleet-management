import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { apiClient } from "../../api/client";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { relativeTime } from "../../utils/format";

export function NotificationsScreen({ navigation }: { navigation: any }) {
  const notifications = useStore(repository.notifications);
  const markAll = async () => {
    try {
      await apiClient.post("/notifications/read-all", {}, undefined);
      repository.loadNotifications();
    } catch {
      /* best-effort */
    }
  };
  return (
    <Screen>
      <ScreenHeader
        title="Notifications"
        onBack={() => navigation.goBack()}
        right={<TouchableOpacity onPress={markAll}><Text style={{ color: colors.primary }}>Mark all read</Text></TouchableOpacity>}
      />
      {notifications.length === 0 ? (
        <EmptyState title="No notifications" message="You're all caught up." />
      ) : (
        notifications.map((n) => (
          <SectionCard key={n.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{n.title}</Text>
              {!n.isRead ? <StatusChip text="NEW" color={colors.statusInfo} /> : null}
            </View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{n.message}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{relativeTime(n.createdAt)}</Text>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

