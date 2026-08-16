import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { commandColors as c, commandSpacing, mono } from "../../screens/admin/commandCenterTheme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { t } from "../../data/i18n";
import { displayStateColor } from "../../theme/colors";
import { QuickActionTile } from "../../components/QuickActionTile";
import { StatusDot } from "../../components/StatusDot";
import { Icon } from "../../components/Icon";
import { fmtDateTime } from "../../utils/format";

function formatHos(minutes: number): string {
  const safe = Math.max(0, minutes);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function DriverHomeScreen({ navigation }: { navigation: any }) {
  const principal = useStore(repository.principal);
  const shift = useStore(repository.activeShift);
  const vehicles = useStore(repository.vehicles);
  const anomalies = useStore(repository.anomalies);
  const hos = useStore(repository.hosState);
  const locale = principal?.locale ?? "en";

  const vehicle =
    vehicles.find((v) => v.id === shift?.vehicleId) ??
    vehicles.find((v) => v.currentDriverName === principal?.email || v.currentDriverName === principal?.phone) ??
    null;

  const quick = [
    { key: "refuel", label: t(locale, "tabs.refuel"), icon: "local-gas-station" as const, danger: false, go: () => navigation.navigate("refuel") },
    { key: "inspection", label: t(locale, "tabs.inspect"), icon: "assignment" as const, danger: false, go: () => navigation.navigate("inspection") },
    { key: "accidents", label: t(locale, "tabs.accidents"), icon: "warning" as const, danger: true, go: () => navigation.navigate("accidents") },
    { key: "vehicle", label: t(locale, "vehicle.title"), icon: "directions-car" as const, danger: false, go: () => navigation.navigate("vehicle_state") },
    { key: "training", label: t(locale, "tabs.training"), icon: "school" as const, danger: false, go: () => navigation.navigate("training_hub") },
    { key: "resources", label: t(locale, "tabs.resources"), icon: "menu-book" as const, danger: false, go: () => navigation.navigate("resource_library") },
    { key: "anomalies", label: t(locale, "tabs.anomalies"), icon: "error" as const, danger: false, go: () => navigation.navigate("anomalies") },
    { key: "notifications", label: t(locale, "notifications.title"), icon: "notifications" as const, danger: false, go: () => navigation.navigate("notifications") },
  ];

  return (
    <View style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.greeting}>{t(locale, "home.greeting")}</Text>
          <Text style={styles.email}>{principal?.email}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate(shift ? "clock_out" : "clock_in")}
            style={styles.clockButton}
          >
            <Icon name={shift ? "logout" : "login"} size={18} color={c.white} />
            <Text style={styles.clockButtonText}>
              {shift ? t(locale, "home.clockOut") : t(locale, "home.clockIn")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.assignmentTopRow}>
            <View>
              <Text style={styles.assignmentLabel}>Current Assignment</Text>
              <Text style={styles.assignmentPlate}>
                {vehicle?.plateNumber ?? t(locale, "home.noActiveShift")}
              </Text>
            </View>
            {vehicle ? (
              <View style={styles.statusRow}>
                <StatusDot color={displayStateColor(vehicle.displayState)} />
                <Text style={[styles.statusText, { color: displayStateColor(vehicle.displayState) }]}>
                  {vehicle.displayState.replace("_", " ")}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.statsRow}>
            <Stat label="Fuel" value={vehicle?.fuelLevelPct != null ? `${vehicle.fuelLevelPct}%` : "—"} />
            <Stat label="Odometer" value={vehicle ? `${vehicle.odometerKm} km` : "—"} />
            <Stat label="HOS" value={formatHos(hos.drivingMinutesToday)} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t(locale, "home.quickActions")}</Text>
        <View style={styles.quickGrid}>
          {quick.map((q) => (
            <View key={q.key} style={styles.quickItem}>
              <QuickActionTile variant="dark" label={q.label} icon={q.icon} danger={q.danger} onPress={q.go} />
            </View>
          ))}
        </View>

        {anomalies.length > 0 ? (
          <View style={styles.anomalyRow}>
            <StatusDot color={c.warning} />
            <Text style={[styles.anomalyText, { color: c.warning }]}>
              {anomalies.length} anomaly(ies) today
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={[styles.statLabel, { color: c.textDim }]}>{label}</Text>
      <Text style={[styles.statValue, mono, { color: c.white }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.canvas },
  content: { flex: 1, padding: commandSpacing.lg, gap: commandSpacing.md },
  card: {
    padding: commandSpacing.lg,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  greeting: { color: c.text, fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  email: { color: c.textMuted, fontSize: 14, marginTop: 4 },
  clockButton: {
    marginTop: commandSpacing.md,
    backgroundColor: c.blue,
    borderRadius: 0,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: commandSpacing.sm,
  },
  clockButtonText: { color: c.white, fontWeight: "600" },
  assignmentTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  assignmentLabel: { color: c.textDim, fontSize: 8, letterSpacing: 0.7 },
  assignmentPlate: { color: c.text, fontSize: 18, fontWeight: "700", marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  statsRow: { flexDirection: "row", marginTop: commandSpacing.md, gap: commandSpacing.lg },
  statLabel: { fontSize: 8, letterSpacing: 0.7 },
  statValue: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  sectionTitle: { color: c.text, fontSize: 18, fontWeight: "600", letterSpacing: -0.3 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: commandSpacing.sm },
  quickItem: { width: "48.5%" },
  anomalyRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  anomalyText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
});
