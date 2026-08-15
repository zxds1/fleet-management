import React from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { fmtDateTime } from "../../utils/format";

export function MyShiftsScreen({ navigation }: { navigation: any }) {
  const shift = useStore(repository.activeShift);
  const hos = useStore(repository.hosState);
  return (
    <Screen>
      <ScreenHeader title="My Shifts" onBack={() => navigation.goBack()} />
      {!shift ? (
        <EmptyState title="No active shift" message="Clock in to start a shift." />
      ) : (
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Active shift</Text>
          <StatusChip text={shift.state} color={colors.statusSafe} />
          <Text style={[typography.bodyMedium, { color: colors.onSurface, marginTop: 12 }]}>Clocked in: {fmtDateTime(shift.clockInAt ?? 0)}</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurface }]}>HOS used: {Math.floor(hos.drivingMinutesToday / 60)}h {hos.drivingMinutesToday % 60}m / {Math.floor(hos.dailyLimitMinutes / 60)}h</Text>
        </SectionCard>
      )}
    </Screen>
  );
}

export function DriverDocumentsScreen({ navigation }: { navigation: any }) {
  const docs = useStore(repository.documents);
  return (
    <Screen>
      <ScreenHeader title="Documents" onBack={() => navigation.goBack()} />
      {docs.length === 0 ? (
        <EmptyState title="No documents" message="Your licences and certificates appear here." />
      ) : (
        docs.map((d) => (
          <SectionCard key={d.id}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{d.title}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Owner: {d.ownerName}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>
              {d.expiresOn ?? "?"} · {d.daysUntilExpiry != null ? `${d.daysUntilExpiry}d left` : ""}
            </Text>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

