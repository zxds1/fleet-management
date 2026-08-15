import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { relativeTime } from "../../utils/format";

export function AccidentsConsoleScreen({ navigation }: { navigation: any }) {
  const accidents = useStore(repository.accidents);
  return (
    <Screen>
      <ScreenHeader title="Accidents Console" onBack={() => navigation.goBack()} />
      {accidents.length === 0 ? (
        <EmptyState title="No accidents" message="Reported accidents appear here." />
      ) : (
        accidents.map((a) => (
          <SectionCard key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{a.vehicleId ?? "Vehicle"} · {a.tierLevel}</Text>
              <StatusChip text={a.status} color={a.status === "PENDING" || a.status === "INVESTIGATING" ? colors.statusDanger : colors.statusSafe} />
            </View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{a.locationName ?? ""} · {relativeTime(a.createdAt)}</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              {a.status !== "INVESTIGATING" && a.status !== "RESOLVED" ? (
                <TouchableOpacity onPress={() => repository.acknowledgeAccident(a.id)}>
                  <Text style={{ color: colors.primary }}>Acknowledge</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

