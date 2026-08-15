import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { EmptyState } from "../../components/States";

/** Driver roster = principals list. Suspend / revoke device from here. Mirrors DriverRosterFragment. */
export function DriverRosterScreen({ navigation }: { navigation: any }) {
  const drivers = useStore(repository.drivers);
  if (drivers.length === 0) return <Screen><ScreenHeader title="Driver Roster" onBack={() => navigation.goBack()} /><EmptyState title="No drivers" message="The driver roster loads from the admin service." /></Screen>;

  return (
    <Screen>
      <ScreenHeader title="Driver Roster" onBack={() => navigation.goBack()} />
      {drivers.map((d) => (
        <SectionCard key={d.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{d.name}</Text>
            <StatusChip text={d.status} color={d.status === "ACTIVE" ? colors.statusSafe : colors.statusWarning} />
          </View>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{d.phone}{d.email ? " · " + d.email : ""}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            {d.status !== "SUSPENDED" ? (
              <TouchableOpacity onPress={() => repository.suspendUser(d.id)}>
                <Text style={{ color: colors.statusDanger }}>Suspend</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => repository.revokeDevice(d.id)}>
              <Text style={{ color: colors.primary }}>Revoke device</Text>
            </TouchableOpacity>
          </View>
        </SectionCard>
      ))}
    </Screen>
  );
}

