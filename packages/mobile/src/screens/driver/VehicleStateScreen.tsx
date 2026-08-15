import React from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { displayStateColor } from "../../theme/colors";
import { EmptyState } from "../../components/States";

export function VehicleStateScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const shift = useStore(repository.activeShift);
  const vehicle = vehicles.find((v) => v.id === shift?.vehicleId) ?? vehicles[0] ?? null;

  if (!vehicle) return <Screen><ScreenHeader title="My Vehicle" onBack={() => navigation.goBack()} /><EmptyState title="No vehicle" message="Assign a vehicle to see its live state." /></Screen>;

  return (
    <Screen>
      <ScreenHeader title="My Vehicle" onBack={() => navigation.goBack()} />
      <SectionCard>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{vehicle.plateNumber}</Text>
          <StatusChip text={vehicle.displayState} color={displayStateColor(vehicle.displayState)} />
        </View>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{vehicle.model} · {vehicle.vehicleClass}</Text>
        <View style={{ flexDirection: "row", marginTop: 12, gap: 24 }}>
          <Stat label="Fuel" value={vehicle.fuelLevelPct != null ? `${vehicle.fuelLevelPct}%` : "—"} />
          <Stat label="Odometer" value={`${vehicle.odometerKm} km`} />
          <Stat label="Speed" value={vehicle.speedKph != null ? `${vehicle.speedKph} km/h` : "—"} />
        </View>
        {vehicle.hosAlert ? <StatusChip text="HOS ALERT" color={colors.stateHosAlert} style={{ alignSelf: "flex-start", marginTop: 12 }} /> : null}
        {vehicle.locationName ? <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 8 }]}>{vehicle.locationName}</Text> : null}
      </SectionCard>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[typography.bodyLarge, { color: colors.onSurface, marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

