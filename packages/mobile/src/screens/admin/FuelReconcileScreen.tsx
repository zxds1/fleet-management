import React from "react";
import { View, Text } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { KpiCard } from "../../components/KpiCard";
import { EmptyState } from "../../components/States";

export function FuelReconcileScreen({ navigation }: { navigation: any }) {
  const logs = useStore(repository.fuelLogs);
  const anomalies = useStore(repository.anomalies);
  const totalLitres = logs.reduce((s, l) => s + (l.litersPumped ?? 0), 0);
  const totalCost = logs.reduce((s, l) => s + (l.amountSpent ?? 0), 0);
  const flagged = anomalies.filter((a) => a.domain === "FUEL");

  return (
    <Screen>
      <ScreenHeader title="Fuel Reconciliation" onBack={() => navigation.goBack()} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <KpiCard label="Litres" value={totalLitres.toFixed(0)} />
        <KpiCard label="Cost" value={`$${totalCost.toFixed(0)}`} />
        <KpiCard label="Flagged" value={String(flagged.length)} color={flagged.length ? colors.statusWarning : undefined} />
      </View>
      {flagged.length === 0 ? (
        <EmptyState title="No anomalies" message="All fuel transactions reconcile." />
      ) : (
        flagged.map((a) => (
          <SectionCard key={a.id}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{a.vehicleId ?? "Vehicle"}</Text>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{a.detail}</Text>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

