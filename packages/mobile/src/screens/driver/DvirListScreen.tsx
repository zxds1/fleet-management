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

export function DvirListScreen({ navigation }: { navigation: any }) {
  const reports = useStore(repository.dvirReports);
  return (
    <Screen>
      <ScreenHeader title="Inspections" onBack={() => navigation.goBack()} />
      {reports.length === 0 ? (
        <EmptyState title="No DVIRs" message="Submitted inspections appear here." />
      ) : (
        reports.map((r) => (
          <SectionCard key={r.id}>
            <TouchableRow onPress={() => navigation.navigate("dvir_detail", { id: r.id })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>
                  {r.vehicleId ?? "Vehicle"}
                </Text>
                <StatusChip text={r.overallStatus} color={r.defectCount > 0 ? colors.statusWarning : colors.statusSafe} />
              </View>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>
                {r.defectCount} defect(s) · {fmtDateTime(r.createdAt)}
              </Text>
            </TouchableRow>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

import { TouchableOpacity } from "react-native";
function TouchableRow({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress}>{children}</TouchableOpacity>;
}

export function DvirDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const reports = useStore(repository.dvirReports);
  const report = reports.find((r) => r.id === route.params?.id);
  return (
    <Screen>
      <ScreenHeader title="DVIR Detail" onBack={() => navigation.goBack()} />
      {!report ? (
        <EmptyState title="Not found" message="This inspection is no longer available." />
      ) : (
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{report.vehicleId}</Text>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{report.subject} · {fmtDateTime(report.createdAt)}</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurface, marginTop: 12 }]}>Status: {report.overallStatus}</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurface }]}>Defects: {report.defectCount}</Text>
          {report.items.length > 0 ? (
            <View style={{ marginTop: spacing.md, gap: 8 }}>
              {report.items.map((i) => (
                <View key={i.templateItemId} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: colors.onSurfaceVariant, fontSize: 14 }}>{i.label}</Text>
                  <StatusChip text={i.result} color={i.result === "FAIL" ? colors.statusDanger : i.result === "PASS" ? colors.statusSafe : colors.onSurfaceVariant} />
                </View>
              ))}
            </View>
          ) : null}
        </SectionCard>
      )}
    </Screen>
  );
}

