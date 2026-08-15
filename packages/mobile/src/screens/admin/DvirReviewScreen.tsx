import React from "react";
import { View, Text } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { fmtDateTime } from "../../utils/format";

/** DVIR review = inspections awaiting admin approval; anomalies flagged for review. */
export function DvirReviewScreen({ navigation }: { navigation: any }) {
  const inspections = useStore(repository.inspections);
  const anomalies = useStore(repository.anomalies);
  const pending = inspections.filter((i) => i.overallStatus === "PENDING_REVIEW" || i.overallStatus === "PENDING");

  return (
    <Screen>
      <ScreenHeader title="DVIR Review" onBack={() => navigation.goBack()} />
      {pending.length === 0 && anomalies.length === 0 ? (
        <EmptyState title="All clear" message="No inspections or anomalies need review." />
      ) : (
        <>
          {pending.map((i) => (
            <SectionCard key={i.id}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{i.vehicleId ?? "Vehicle"}</Text>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{i.driverName} · {i.defectCount} defects · {fmtDateTime(i.createdAt)}</Text>
              <StatusChip text={i.overallStatus} color={i.defectCount > 0 ? colors.statusWarning : colors.statusSafe} style={{ alignSelf: "flex-start", marginTop: 8 }} />
            </SectionCard>
          ))}
          {anomalies.map((a) => (
            <SectionCard key={a.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{a.domain}</Text>
                <StatusChip text={a.severity} color={a.severity === "CRITICAL" ? colors.statusDanger : colors.statusWarning} />
              </View>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{a.vehicleId ?? "Vehicle"} · {fmtDateTime(a.createdAt)}</Text>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{a.detail}</Text>
            </SectionCard>
          ))}
        </>
      )}
    </Screen>
  );
}

