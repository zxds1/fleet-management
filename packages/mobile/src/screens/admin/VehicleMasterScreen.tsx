import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { displayStateColor } from "../../theme/colors";

export function VehicleMasterScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const [editing, setEditing] = useState<{ id: string; plate: string } | null>(null);

  if (vehicles.length === 0) return <Screen><ScreenHeader title="Vehicle Master" onBack={() => navigation.goBack()} /><EmptyState title="No vehicles" message="Vehicle registry loads from the fleet service." /></Screen>;

  return (
    <Screen>
      <ScreenHeader title="Vehicle Master" onBack={() => navigation.goBack()} />
      {vehicles.map((v) => (
        <SectionCard key={v.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{v.plateNumber}</Text>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{v.model} · {v.vehicleClass}</Text>
            </View>
            <StatusChip text={v.displayState} color={displayStateColor(v.displayState)} />
          </View>
          <TouchableOpacity onPress={() => repository.swapTrailer(v.id, "trailer-" + Date.now())} style={{ marginTop: 8 }}>
            <Text style={{ color: colors.primary }}>Swap trailer</Text>
          </TouchableOpacity>
        </SectionCard>
      ))}
    </Screen>
  );
}

