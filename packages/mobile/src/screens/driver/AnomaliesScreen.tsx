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

export function AnomaliesScreen({ navigation }: { navigation: any }) {
  const anomalies = useStore(repository.anomalies);
  const colorFor = (s: string) => (s === "CRITICAL" ? colors.statusDanger : s === "WARNING" ? colors.statusWarning : colors.statusInfo);
  return (
    <Screen>
      <ScreenHeader title="Anomalies" onBack={() => navigation.goBack()} />
      {anomalies.length === 0 ? (
        <EmptyState title="All clear" message="No open anomalies right now." />
      ) : (
        anomalies.map((a) => (
          <SectionCard key={a.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{a.title}</Text>
              <StatusChip text={a.severity} color={colorFor(a.severity)} />
            </View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{a.detail}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{a.domain} · {relativeTime(a.createdAt)}</Text>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

