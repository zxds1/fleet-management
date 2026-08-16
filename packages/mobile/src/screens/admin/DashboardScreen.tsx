import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../components/Icon";
import type { AccidentReport, Vehicle } from "../../data/types";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { CommandCenterMap } from "./CommandCenterMap";
import { commandColors as c, mono } from "./commandCenterTheme";

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "JUST NOW";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} HR AGO`;
  return `${Math.floor(hours / 24)} DAY AGO`;
}

function SectionHeading({ title, meta, success }: { title: string; meta: string; success?: boolean }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionMetaRow}>
        {success ? <View style={styles.metaDot} /> : null}
        <Text style={[styles.sectionMeta, success && { color: c.success }]}>{meta}</Text>
      </View>
    </View>
  );
}

function HealthMetric({ label, value, detail, color = c.text }: { label: string; value: string; detail: string; color?: string }) {
  return (
    <View style={styles.healthMetric}>
      <Text style={styles.healthLabel}>{label}</Text>
      <Text style={[styles.healthValue, mono, { color }]}>{value}</Text>
      <Text style={styles.healthDetail}>{detail}</Text>
    </View>
  );
}

function OperationRow({
  icon,
  iconColor,
  title,
  detail,
  badge,
  count,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  iconColor: string;
  title: string;
  detail: string;
  badge?: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.operationRow}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
    >
      <View style={[styles.operationIcon, { borderColor: `${iconColor}40`, backgroundColor: `${iconColor}0E` }]}>
        <Icon name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.operationCopy}>
        <Text style={styles.operationTitle}>{title}</Text>
        <Text style={styles.operationDetail} numberOfLines={1}>{detail}</Text>
      </View>
      {count != null ? <Text style={[styles.operationCount, mono, { color: iconColor }]}>{String(count).padStart(2, "0")}</Text> : null}
      {badge ? <Text style={styles.urgentBadge}>{badge}</Text> : <Icon name="chevron-right" size={17} color={c.textDim} />}
    </TouchableOpacity>
  );
}

function CriticalIncident({
  incident,
  vehicle,
  onAcknowledge,
  onDispatch,
}: {
  incident: AccidentReport;
  vehicle: Vehicle | null;
  onAcknowledge: () => Promise<void>;
  onDispatch: () => void;
}) {
  const [acknowledging, setAcknowledging] = useState(false);

  async function acknowledge() {
    if (incident.acknowledged || acknowledging) return;
    setAcknowledging(true);
    try {
      await onAcknowledge();
    } catch (error) {
      Alert.alert("Could not acknowledge", error instanceof Error ? error.message : "Try again when the connection is restored.");
    } finally {
      setAcknowledging(false);
    }
  }

  return (
    <View style={styles.incidentSection}>
      <View style={styles.incidentTopRow}>
        <View style={styles.incidentIcon}>
          <Icon name="warning" size={18} color={c.dangerSoft} />
        </View>
        <View style={styles.incidentCopy}>
          <View style={styles.incidentEyebrowRow}>
            <Text style={styles.incidentEyebrow}>{incident.isMayday ? "MAYDAY" : "INCIDENT"} · COLLISION</Text>
            <Text style={[styles.incidentTime, mono]}>{formatRelativeTime(incident.createdAt)}</Text>
          </View>
          <Text style={styles.incidentVehicle}>
            {vehicle?.plateNumber ?? "VEHICLE ALERT"}
            <Text style={styles.incidentLocation}> · {incident.locationName ?? "Location pending"}</Text>
          </Text>
          <Text style={styles.incidentDetail} numberOfLines={1}>
            {incident.driverStatement ?? "Impact detected · driver awaiting dispatch"}
          </Text>
        </View>
      </View>
      <View style={styles.incidentActions}>
        <TouchableOpacity
          style={[styles.secondaryAction, incident.acknowledged && styles.acknowledgedAction]}
          onPress={acknowledge}
          disabled={incident.acknowledged || acknowledging}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryActionText, incident.acknowledged && { color: c.successSoft }]}>
            {acknowledging ? "Acknowledging…" : incident.acknowledged ? "Acknowledged" : "Acknowledge"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryAction} onPress={onDispatch} activeOpacity={0.8} accessibilityRole="button">
          <Icon name="route" size={16} color={c.canvas} />
          <Text style={styles.primaryActionText}>Dispatch</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function DashboardScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const accidents = useStore(repository.accidents);
  const dashboard = useStore(repository.adminDashboard);
  const hos = useStore(repository.hosState);
  const hardware = useStore(repository.pendingHardware);
  const notifications = useStore(repository.notifications);
  const isOnline = useStore(repository.isNetworkConnected);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    repository.loadAccidentsAdmin();
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const positionedVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.lat != null && vehicle.lng != null),
    [vehicles],
  );
  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? positionedVehicles[0] ?? vehicles[0] ?? null,
    [positionedVehicles, selectedVehicleId, vehicles],
  );
  const openAccidents = useMemo(
    () => accidents.filter((accident) => accident.status === "PENDING" || accident.status === "INVESTIGATING"),
    [accidents],
  );
  const criticalIncident = openAccidents.find((accident) => accident.isMayday) ?? openAccidents[0] ?? null;
  const incidentVehicle = criticalIncident
    ? vehicles.find((vehicle) => vehicle.id === criticalIncident.vehicleId) ?? null
    : null;
  const offlineCount = vehicles.filter((vehicle) => vehicle.displayState === "OFFLINE").length;
  const holdCount = vehicles.filter((vehicle) => vehicle.displayState === "QUARANTINED").length;
  const activeCount = dashboard?.activeFleet ?? vehicles.filter((vehicle) => ["MOVING", "IDLING", "PARKED"].includes(vehicle.displayState)).length;
  const delayedCount = hardware.filter((device) => device.status === "OFFLINE" || device.status === "LOST").length;
  const unreadCount = notifications.filter((notification) => !notification.isRead).length;
  const hosMinutesLeft = Math.max(0, hos.dailyLimitMinutes - hos.drivingMinutesToday);
  const utilization = vehicles.length > 0 ? Math.round((activeCount / vehicles.length) * 100) : 0;

  async function refresh() {
    setRefreshing(true);
    await Promise.all([
      repository.loadVehicleStates(),
      repository.loadAdminDashboard(),
      repository.loadAccidentsAdmin(),
      repository.loadHardware(),
      repository.loadNotifications(),
    ]);
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.blueSoft} colors={[c.blue]} />}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandText}>FS</Text></View>
          <View style={styles.headerCopy}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>Command center</Text>
              <View style={styles.liveRow}>
                <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
                <Text style={styles.liveText}>{isOnline ? "LIVE" : "OFFLINE"}</Text>
              </View>
            </View>
            <Text style={styles.subtitle} numberOfLines={1}>
              Night operations · {new Intl.DateTimeFormat("en", { weekday: "short", day: "2-digit", month: "short" }).format(new Date())} · {isOnline ? "Synced now" : "Sync paused"}
            </Text>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={() => navigation.navigate("vehicle_master")} accessibilityRole="button" accessibilityLabel="Search fleet">
            <Icon name="search" size={19} color="#BFC0C7" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerAction} onPress={() => navigation.navigate("console")} accessibilityRole="button" accessibilityLabel={`${unreadCount} notifications`}>
            <Icon name="notifications-none" size={19} color="#BFC0C7" />
            {unreadCount > 0 ? <View style={styles.notificationDot} /> : null}
          </TouchableOpacity>
        </View>

        <CommandCenterMap
          vehicles={vehicles}
          selectedVehicle={selectedVehicle}
          hosMinutesLeft={hosMinutesLeft}
          delayedCount={delayedCount}
          onSelectVehicle={(vehicle) => setSelectedVehicleId(vehicle.id)}
          onOpenVehicle={() => navigation.navigate("vehicle_master")}
          onOpenMap={() => navigation.navigate("map")}
        />

        {criticalIncident ? (
          <CriticalIncident
            incident={criticalIncident}
            vehicle={incidentVehicle}
            onAcknowledge={() => repository.acknowledgeAccident(criticalIncident.id)}
            onDispatch={() => navigation.navigate("console")}
          />
        ) : (
          <View style={styles.clearStatus}>
            <Icon name="verified" size={18} color={c.success} />
            <View style={styles.clearStatusCopy}>
              <Text style={styles.clearStatusTitle}>No critical incidents</Text>
              <Text style={styles.clearStatusDetail}>Dispatch queue is clear across the live fleet.</Text>
            </View>
          </View>
        )}

        <View style={styles.healthSection}>
          <SectionHeading title="FLEET HEALTH" meta="LAST 15 MIN" />
          <View style={styles.healthGrid}>
            <View style={styles.activeMetric}>
              <Text style={styles.healthLabel}>ACTIVE</Text>
              <View style={styles.activeValueRow}>
                <Text style={[styles.activeValue, mono]}>{activeCount}</Text>
                <Text style={[styles.activeTotal, mono]}>/{vehicles.length}</Text>
              </View>
              <View style={styles.sparkline}>
                {[28, 38, 34, 55, 48, 72, 82].map((height, index) => (
                  <View key={index} style={[styles.sparkBar, { height: `${height}%` }]} />
                ))}
              </View>
              <Text style={styles.utilization}>{utilization}% utilization</Text>
            </View>
            <HealthMetric label="DVIR" value={String(dashboard?.pendingDvir ?? 0)} detail="Requires review" color={c.warning} />
            <HealthMetric label="HOLD" value={String(holdCount)} detail="Quarantined" color={c.dangerSoft} />
            <HealthMetric label="OFFLINE" value={String(offlineCount)} detail={`${delayedCount} delayed`} color="#BFC0C7" />
          </View>
        </View>

        <View style={styles.operationsSection}>
          <SectionHeading title="OPERATIONS QUEUE" meta="Auto-prioritized" success />
          <OperationRow
            icon="assignment-turned-in"
            iconColor={c.warning}
            title={`Review ${dashboard?.pendingDvir ?? 0} DVIRs`}
            detail="Blocker defects and shift reviews"
            count={dashboard?.pendingDvir ?? 0}
            onPress={() => navigation.navigate("dvir_review")}
          />
          {criticalIncident ? (
            <OperationRow
              icon="local-shipping"
              iconColor={c.dangerSoft}
              title="Assign roadside unit"
              detail={`${criticalIncident.locationName ?? "Incident location"} · dispatch nearby unit`}
              badge="URGENT"
              onPress={() => navigation.navigate("console")}
            />
          ) : null}
          <OperationRow
            icon="devices"
            iconColor="#BFC0C7"
            title={`Resolve ${delayedCount} offline trackers`}
            detail="Inspect delayed or missing device pings"
            onPress={() => navigation.navigate("hardware_tracker")}
          />
          <TouchableOpacity style={styles.allOperations} onPress={() => navigation.navigate("profile")} accessibilityRole="button">
            <Text style={styles.allOperationsText}>All operations</Text>
            <View style={styles.allOperationsMeta}>
              <Text style={styles.allOperationsDetail}>Roster · Fuel · Maintenance</Text>
              <Icon name="arrow-forward" size={15} color={c.blueSoft} />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.canvas },
  scroll: { flex: 1, backgroundColor: c.canvas },
  content: { paddingBottom: 24 },
  header: { minHeight: 82, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.canvas },
  brandMark: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(15,98,254,0.58)", backgroundColor: "rgba(15,98,254,0.10)" },
  brandText: { color: c.white, fontSize: 13, fontWeight: "700" },
  headerCopy: { flex: 1, minWidth: 0, marginLeft: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: c.text, fontSize: 18, lineHeight: 22, fontWeight: "700", letterSpacing: -0.3, flexShrink: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.success },
  liveText: { color: c.successSoft, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  subtitle: { marginTop: 4, color: c.textMuted, fontSize: 9.5 },
  headerAction: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, backgroundColor: "rgba(255,255,255,0.035)" },
  notificationDot: { position: "absolute", right: 8, top: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: c.danger },
  incidentSection: { paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "rgba(218,30,40,0.25)", backgroundColor: c.surfaceCritical },
  incidentTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  incidentIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(218,30,40,0.35)", backgroundColor: "rgba(218,30,40,0.10)" },
  incidentCopy: { flex: 1, minWidth: 0 },
  incidentEyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  incidentEyebrow: { color: c.dangerSoft, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  incidentTime: { color: "#A8A8AF", fontSize: 9 },
  incidentVehicle: { marginTop: 5, color: c.white, fontSize: 13, fontWeight: "700" },
  incidentLocation: { color: c.textMuted, fontWeight: "400" },
  incidentDetail: { marginTop: 4, color: c.textDim, fontSize: 9 },
  incidentActions: { marginTop: 12, marginLeft: 44, flexDirection: "row", gap: 8 },
  secondaryAction: { flex: 1, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.borderStrong },
  acknowledgedAction: { borderColor: "rgba(66,190,101,0.35)" },
  secondaryActionText: { color: "#D6D6DA", fontSize: 11, fontWeight: "700" },
  primaryAction: { flex: 1, height: 42, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: c.white },
  primaryActionText: { color: c.canvas, fontSize: 11, fontWeight: "700" },
  clearStatus: { minHeight: 70, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surfaceRaised },
  clearStatusCopy: { flex: 1 },
  clearStatusTitle: { color: c.text, fontSize: 12, fontWeight: "600" },
  clearStatusDetail: { marginTop: 3, color: c.textDim, fontSize: 9 },
  healthSection: { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  sectionHeading: { marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: "#D6D6DA", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  sectionMetaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.success },
  sectionMeta: { color: c.textDim, fontSize: 9 },
  healthGrid: { minHeight: 116, flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border, backgroundColor: "rgba(255,255,255,0.018)" },
  activeMetric: { flex: 1.35, padding: 12, borderRightWidth: 1, borderRightColor: c.border },
  healthMetric: { flex: 0.9, paddingHorizontal: 8, paddingVertical: 12, borderRightWidth: 1, borderRightColor: c.border },
  healthLabel: { color: "#A8A8AF", fontSize: 8, letterSpacing: 0.7 },
  activeValueRow: { marginTop: 4, flexDirection: "row", alignItems: "baseline", gap: 3 },
  activeValue: { color: c.white, fontSize: 22, fontWeight: "600" },
  activeTotal: { color: c.textDim, fontSize: 10 },
  healthValue: { marginTop: 8, fontSize: 21, fontWeight: "600" },
  healthDetail: { marginTop: 12, color: c.textDim, fontSize: 8, lineHeight: 11 },
  sparkline: { height: 14, marginTop: 7, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  sparkBar: { flex: 1, minHeight: 2, backgroundColor: c.success, opacity: 0.7 },
  utilization: { marginTop: 4, color: c.success, fontSize: 8 },
  operationsSection: { paddingHorizontal: 16, paddingVertical: 16 },
  operationRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  operationIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitle: { color: c.white, fontSize: 12, fontWeight: "600" },
  operationDetail: { marginTop: 4, color: c.textDim, fontSize: 9 },
  operationCount: { fontSize: 10, fontWeight: "600" },
  urgentBadge: { paddingHorizontal: 6, paddingVertical: 3, color: c.dangerSoft, fontSize: 8, fontWeight: "700", borderWidth: 1, borderColor: "rgba(218,30,40,0.25)" },
  allOperations: { height: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  allOperationsText: { color: c.blueSoft, fontSize: 11, fontWeight: "600" },
  allOperationsMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  allOperationsDetail: { color: c.textDim, fontSize: 9 },
});
