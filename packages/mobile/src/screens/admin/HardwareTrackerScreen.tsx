import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";
import { AuthField } from "../../components/AuthField";
import { FleetButton } from "../../components/FleetButton";

/** Hardware tracker pairing console. Mirrors HardwareTrackerFragment. */
export function HardwareTrackerScreen({ navigation }: { navigation: any }) {
  const pending = useStore(repository.pendingHardware);
  const [code, setCode] = useState("");
  const [paired, setPaired] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const pair = async () => {
    if (!code.trim()) return;
    setPairing(true);
    try {
      await repository.pairTracker("veh-" + code, code, "GENERIC");
      setPaired(code);
      setCode("");
    } finally {
      setPairing(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Hardware Tracker" onBack={() => navigation.goBack()} />

      <SectionCard>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>Pair a new tracker</Text>
        <View style={{ marginTop: 12 }}>
          <AuthField value={code} onChangeText={setCode} label="Pairing code" placeholder="Enter IMEI or pairing code" />
          <FleetButton text="Pair" onPress={pair} enabled={!pairing && code.trim().length > 0} />
        </View>
        {paired ? <Text style={{ color: colors.statusSafe, marginTop: 12 }}>Paired {paired}</Text> : null}
      </SectionCard>

      {pending.length === 0 ? (
        <EmptyState title="No pending devices" message="Unpaired tracker requests appear here." />
      ) : (
        pending.map((h) => (
          <SectionCard key={h.deviceId}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{h.vehiclePlate ?? h.deviceId}</Text>
              <StatusChip text={h.status} color={colors.statusWarning} />
            </View>
            <TouchableOpacity
              onPress={() => repository.pairTracker(h.vehicleId ?? h.deviceId, h.deviceId, h.brand ?? "GENERIC")}
              style={{ marginTop: 8 }}
            >
              <Text style={{ color: colors.primary }}>Approve pairing</Text>
            </TouchableOpacity>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}
