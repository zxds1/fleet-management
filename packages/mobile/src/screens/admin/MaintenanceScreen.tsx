import React from "react";
import { View, Text } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";

export function MaintenanceScreen({ navigation }: { navigation: any }) {
  const maintenance = useStore(repository.maintenanceRecords);
  const issues = useStore(repository.vehicleIssues);

  return (
    <Screen>
      <ScreenHeader title="Maintenance" onBack={() => navigation.goBack()} />
      {maintenance.length === 0 && issues.length === 0 ? (
        <EmptyState title="Nothing due" message="Maintenance records and vehicle issues appear here." />
      ) : (
        <>
          {issues.map((i) => (
            <SectionCard key={i.id} title={i.vehicleId ?? "Vehicle"}>
              <StatusChip text={i.severity} color={i.severity === "CRITICAL" ? colors.statusDanger : colors.statusWarning} />
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 6 }]}>{i.category}: {i.description}</Text>
            </SectionCard>
          ))}
          {maintenance.map((m) => (
            <SectionCard key={m.id} title={`${m.assetKind} · ${m.taskCode}`}>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{m.vendor ?? "—"} · ${m.cost?.toFixed(2) ?? "0.00"} · {m.performedAt}</Text>
            </SectionCard>
          ))}
        </>
      )}
    </Screen>
  );
}

