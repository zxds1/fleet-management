import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { t } from "../../data/i18n";
import { displayStateColor } from "../../theme/colors";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { FleetButton } from "../../components/FleetButton";
import { QuickActionTile } from "../../components/QuickActionTile";
import { Icon } from "../../components/Icon";
import { fmtDateTime } from "../../utils/format";

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
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      <SectionCard>
        <Text style={[typography.titleLarge, { color: colors.onSurface }]}>{t(locale, "home.greeting")}</Text>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{principal?.email}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate(shift ? "clock_out" : "clock_in")}
          style={{
            marginTop: 16,
            backgroundColor: colors.primary,
            borderRadius: 0,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
          }}
        >
          <Icon name={shift ? "logout" : "login"} size={18} color={colors.onPrimary} />
          <Text style={{ color: colors.onPrimary, fontWeight: "600" }}>
            {shift ? t(locale, "home.clockOut") : t(locale, "home.clockIn")}
          </Text>
        </TouchableOpacity>
      </SectionCard>

      <SectionCard>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Current Assignment</Text>
            <Text style={[typography.titleMedium, { color: colors.onSurface, marginTop: 4 }]}>
              {vehicle?.plateNumber ?? t(locale, "home.noActiveShift")}
            </Text>
          </View>
          {vehicle ? <StatusChip text={vehicle.displayState} color={displayStateColor(vehicle.displayState)} /> : null}
        </View>
        <View style={{ flexDirection: "row", marginTop: 12, gap: 16 }}>
          <Stat label="Fuel" value={vehicle?.fuelLevelPct != null ? `${vehicle.fuelLevelPct}%` : "—"} />
          <Stat label="Odometer" value={vehicle ? `${vehicle.odometerKm} km` : "—"} />
          <Stat label="HOS" value={`${Math.floor(hos.drivingMinutesToday / 60)}h ${hos.drivingMinutesToday % 60}m`} />
        </View>
      </SectionCard>

      <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{t(locale, "home.quickActions")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {quick.map((q) => (
            <View key={q.key} style={{ width: "48.5%" }}>
              <QuickActionTile label={q.label} icon={q.icon} danger={q.danger} onPress={q.go} />
            </View>
        ))}
      </View>

      {anomalies.length > 0 ? (
        <StatusChip text={`${anomalies.length} anomaly(ies) today`} color={colors.statusWarning} />
      ) : null}
    </View>
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


