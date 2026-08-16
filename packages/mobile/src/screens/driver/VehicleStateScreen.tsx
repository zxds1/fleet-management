import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { commandColors as c, commandSpacing, mono } from "../../screens/admin/commandCenterTheme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { StatusDot } from "../../components/StatusDot";
import { TelemetryCard } from "../../components/TelemetryCard";
import { EmptyState } from "../../components/States";
import { displayStateColor } from "../../theme/colors";

function formatDuration(minutes: number): string {
  const safe = Math.max(0, minutes);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function VehicleStateScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const shift = useStore(repository.activeShift);
  const vehicle = vehicles.find((v) => v.id === shift?.vehicleId) ?? vehicles[0] ?? null;

  if (!vehicle) {
    return (
      <View style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Vehicle</Text>
          <View style={styles.headerRight} />
        </View>
        <EmptyState title="No vehicle" message="Assign a vehicle to see its live state." />
      </View>
    );
  }

  const statusColor = displayStateColor(vehicle.displayState);

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Vehicle</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.content}>
        <TelemetryCard
          metrics={[
            { label: "FUEL", value: `${Math.round(vehicle.fuelLevelPct ?? 0)}%`, unit: "%", fuelPct: vehicle.fuelLevelPct ?? 0 },
            { label: "ODOMETER", value: `${Math.round(vehicle.odometerKm).toLocaleString()}`, unit: "KM" },
            { label: "SPEED", value: `${Math.round(vehicle.speedKph ?? 0)}`, unit: "km/h" },
          ]}
        >
          <View style={styles.vehicleTopRow}>
            <Text style={[styles.plate, mono]}>{vehicle.plateNumber}</Text>
            <View style={styles.statusRow}>
              <StatusDot color={statusColor} />
              <Text style={[styles.status, { color: statusColor }]}>{vehicle.displayState.replace("_", " ")}</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            {vehicle.model} · {vehicle.vehicleClass}
          </Text>
          {vehicle.hosAlert ? (
            <View style={styles.hosAlertRow}>
              <StatusDot color={c.warning} />
              <Text style={[styles.hosText, { color: c.warning }]}>HOS ALERT</Text>
            </View>
          ) : null}
          {vehicle.locationName ? (
            <Text style={[styles.subtitle, { marginTop: 8 }]}>{vehicle.locationName}</Text>
          ) : null}
        </TelemetryCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.canvas },
  header: {
    minHeight: 52,
    paddingHorizontal: commandSpacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.canvas,
  },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: c.blueSoft, fontSize: 14, fontWeight: "600" },
  headerTitle: { color: c.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  headerRight: { width: 40 },
  content: { flex: 1, padding: commandSpacing.lg, gap: commandSpacing.md },
  vehicleTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  plate: { color: c.white, fontSize: 18, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  status: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  subtitle: { color: c.textMuted, fontSize: 12, marginTop: 4 },
  hosAlertRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 },
  hosText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  hosCard: {
    padding: commandSpacing.lg,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  hosLabel: { color: c.textDim, fontSize: 8, letterSpacing: 0.7, marginBottom: 4 },
  hosValue: { color: c.white, fontSize: 22, fontWeight: "600" },
});
