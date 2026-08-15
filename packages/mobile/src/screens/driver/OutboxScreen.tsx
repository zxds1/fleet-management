import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { relativeTime } from "../../utils/format";

/** Mirrors OutboxScreen — the offline-first queue with retry / discard. */
export function OutboxScreen({ navigation }: { navigation: any }) {
  const queue = useStore(repository.queueItems);
  const isConnected = useStore(repository.isNetworkConnected);

  const pending = queue.filter((i) => i.status !== "DONE" && i.status !== "DISCARDED");

  return (
    <Screen>
      <ScreenHeader title="Outbox" onBack={() => navigation.goBack()} />
      {pending.length === 0 ? (
        <EmptyState title="Outbox clear" message={isConnected ? "All writes have synced." : "Offline — writes queue locally."} />
      ) : (
        pending.map((item) => (
          <SectionCard key={item.id}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{item.summary}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>
              {item.method} {item.path} · {relativeTime(item.timestamp)} · attempts {item.attempts}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <StatusChip
                text={item.status}
                color={item.status === "DONE" ? colors.statusSafe : item.status === "FAILED_REVIEW" || item.status === "DISCARDED" ? colors.statusDanger : colors.statusWarning}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => repository.retryQueueItem(item.id)}>
                  <Text style={{ color: colors.primary }}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => repository.discardQueueItem(item.id)}>
                  <Text style={{ color: colors.statusDanger }}>Discard</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

