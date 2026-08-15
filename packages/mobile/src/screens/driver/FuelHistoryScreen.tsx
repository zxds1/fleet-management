import React from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { money } from "../../utils/format";
import { EmptyState } from "../../components/States";

export function FuelHistoryScreen({ navigation }: { navigation: any }) {
  const purchases = useStore(repository.refuelPurchases);
  return (
    <Screen>
      <ScreenHeader title="Fuel History" onBack={() => navigation.goBack()} />
      {purchases.length === 0 ? (
        <EmptyState title="No fuel records" message="Submitted refuels appear here once synced." />
      ) : (
        purchases.map((p) => (
          <SectionCard key={p.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{p.vehiclePlate ?? "Vehicle"}</Text>
              <StatusChip text={p.approvalStatus} color={p.approvalStatus === "APPROVED" ? colors.statusSafe : colors.statusWarning} />
            </View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{p.driverName ?? ""}</Text>
            <Text style={[typography.bodyMedium, { color: colors.onSurface, marginTop: 8 }]}>{money(p.amountSpent)}</Text>
            {p.litersPumped != null ? (
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{p.litersPumped} L · {p.odometerKm ?? "?"} km</Text>
            ) : null}
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

