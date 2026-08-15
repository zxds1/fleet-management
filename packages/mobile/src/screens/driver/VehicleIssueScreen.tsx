import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography, radius } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { AppConstants } from "../../data/constants";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { AuthField } from "../../components/AuthField";

export function VehicleIssueScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [category, setCategory] = useState<string>(AppConstants.VEHICLE_ISSUE_CATEGORIES[0]);
  const [severity, setSeverity] = useState("WARNING");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);

  const submit = () => {
    repository.reportVehicleIssue(vehicleId || "unknown", category, description, severity);
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <ScreenHeader title="Vehicle Issue" onBack={() => navigation.goBack()} />
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Issue reported</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>
            Your non-accident defect report was queued for the maintenance team.
          </Text>
          <FleetButton text="Done" onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Report Issue" onBack={() => navigation.goBack()} />
      <SectionCard>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>Vehicle: {vehicles.find((v) => v.id === vehicleId)?.plateNumber ?? "—"}</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Category</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {AppConstants.VEHICLE_ISSUE_CATEGORIES.map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Severity</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {["INFO", "WARNING", "CRITICAL"].map((s) => (
              <Chip key={s} label={s} active={severity === s} onPress={() => setSeverity(s)} />
            ))}
          </View>
          <AuthField value={description} onChangeText={setDescription} label="Description" placeholder="Describe the defect" />
        </View>
        <FleetButton text="Submit issue" onPress={submit} enabled={description.length > 0} style={{ marginTop: spacing.md }} />
      </SectionCard>
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.outlineVariant,
        backgroundColor: active ? colors.primaryContainer : colors.background,
      }}
    >
      <Text style={{ color: colors.onSurface, fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

