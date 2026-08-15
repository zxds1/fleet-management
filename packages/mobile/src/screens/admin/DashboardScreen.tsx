import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { KpiCard } from "../../components/KpiCard";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { AdminActionTile } from "../../components/AdminActionTile";
import { displayStateColor } from "../../theme/colors";

export function DashboardScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const accidents = useStore(repository.accidents);
  const anomalies = useStore(repository.anomalies);
  const dashboard = useStore(repository.adminDashboard);
  const hos = useStore(repository.hosState);

  const states = vehicles.reduce<Record<string, number>>((acc, v) => {
    acc[v.displayState] = (acc[v.displayState] ?? 0) + 1;
    return acc;
  }, {});

  const openAccidents = accidents.filter((a) => a.status === "PENDING" || a.status === "INVESTIGATING").length;

  return (
    <Screen>
      <ScreenHeader title="Fleet Dashboard" onBack={() => {}} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <KpiCard label="Vehicles" value={String(vehicles.length)} onPress={() => navigation.navigate("vehicle_master")} />
        <KpiCard label="Active fleet" value={String(dashboard?.activeFleet ?? 0)} onPress={() => navigation.navigate("vehicle_master")} />
        <KpiCard label="Open accidents" value={String(openAccidents)} onPress={() => navigation.navigate("console")} color={openAccidents ? colors.statusDanger : undefined} />
        <KpiCard label="Pending DVIR" value={String(dashboard?.pendingDvir ?? 0)} onPress={() => navigation.navigate("dvir_review")} color={dashboard?.pendingDvir ? colors.statusWarning : undefined} />
        <KpiCard label="Open anomalies" value={String(dashboard?.anomaliesOpen ?? 0)} onPress={() => navigation.navigate("dvir_review")} color={dashboard?.anomaliesOpen ? colors.statusDanger : undefined} />
        <KpiCard label="Expiring docs" value={String(dashboard?.expiringDocs ?? 0)} onPress={() => navigation.navigate("privacy")} color={dashboard?.expiringDocs ? colors.statusWarning : undefined} />
      </View>

      <Text style={[typography.titleMedium, { color: colors.onSurface, marginTop: spacing.sm }]}>Admin Tools</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <AdminActionTile label="Driver Roster" icon="groups-2" onPress={() => navigation.navigate("driver_roster")} />
        <AdminActionTile label="Hardware Tracker" icon="devices" onPress={() => navigation.navigate("hardware_tracker")} />
        <AdminActionTile label="Fuel Reconciliation" icon="local-gas-station" onPress={() => navigation.navigate("fuel_reconcile")} />
        <AdminActionTile label="Import Statements" icon="description" onPress={() => navigation.navigate("import_statement")} />
        <AdminActionTile label="Maintenance" icon="build" onPress={() => navigation.navigate("maintenance")} />
        <AdminActionTile label="Accidents Console" icon="error" onPress={() => navigation.navigate("console")} />
        <AdminActionTile label="Privacy & Data" icon="shield" onPress={() => navigation.navigate("privacy")} />
        <AdminActionTile label="Settings" icon="settings" onPress={() => navigation.navigate("settings")} />
      </View>

      <SectionCard title="Vehicle states">
        {Object.keys(states).length === 0 ? (
          <Text style={{ color: colors.onSurfaceVariant }}>No vehicles.</Text>
        ) : (
          Object.entries(states).map(([s, n]) => (
            <View key={s} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
              <Text style={{ color: colors.onSurface }}>{s}</Text>
              <Text style={{ color: displayStateColor(s), fontWeight: "700" }}>{n}</Text>
            </View>
          ))
        )}
      </SectionCard>
    </Screen>
  );
}
