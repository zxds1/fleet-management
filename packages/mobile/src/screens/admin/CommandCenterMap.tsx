import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { Icon } from "../../components/Icon";
import type { Vehicle } from "../../data/types";
import { displayStateColor } from "../../theme/colors";
import { commandColors as c, darkMapStyle, mono } from "./commandCenterTheme";

interface CommandCenterMapProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  hosMinutesLeft: number;
  delayedCount: number;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onOpenVehicle: () => void;
  onOpenMap: () => void;
}

function regionFor(vehicles: Vehicle[]): Region {
  const positioned = vehicles.filter((vehicle) => vehicle.lat != null && vehicle.lng != null);
  if (positioned.length === 0) {
    return { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.5, longitudeDelta: 0.5 };
  }

  const latitudes = positioned.map((vehicle) => vehicle.lat!);
  const longitudes = positioned.map((vehicle) => vehicle.lng!);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.08, (maxLatitude - minLatitude) * 1.8),
    longitudeDelta: Math.max(0.08, (maxLongitude - minLongitude) * 1.8),
  };
}

function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, minutes);
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, "0")}:${String(safeMinutes % 60).padStart(2, "0")}`;
}

function TelemetryMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
        <Text style={[styles.metricValue, mono]} numberOfLines={1}>{value}</Text>
        {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function CommandCenterMap({
  vehicles,
  selectedVehicle,
  hosMinutesLeft,
  delayedCount,
  onSelectVehicle,
  onOpenVehicle,
  onOpenMap,
}: CommandCenterMapProps) {
  const positioned = vehicles.filter((vehicle) => vehicle.lat != null && vehicle.lng != null);
  const selectedColor = selectedVehicle ? displayStateColor(selectedVehicle.displayState) : c.success;

  return (
    <View style={styles.container} accessibilityLabel="Live fleet map">
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={regionFor(vehicles)}
        customMapStyle={[...darkMapStyle]}
        toolbarEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        onPress={onOpenMap}
      >
        {positioned.map((vehicle) => {
          const selected = selectedVehicle?.id === vehicle.id;
          const markerColor = displayStateColor(vehicle.displayState);
          return (
            <Marker
              key={vehicle.id}
              coordinate={{ latitude: vehicle.lat!, longitude: vehicle.lng! }}
              onPress={(event) => {
                event.stopPropagation();
                onSelectVehicle(vehicle);
              }}
              tracksViewChanges={selected}
              accessibilityLabel={`Select vehicle ${vehicle.plateNumber}`}
            >
              <View style={[styles.marker, selected && { borderColor: markerColor, backgroundColor: `${markerColor}24` }]}>
                <Icon name="navigation" size={selected ? 21 : 18} color={markerColor} />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={styles.mapScrim} pointerEvents="none" />
      <View style={styles.mapMeta} pointerEvents="box-none">
        <View style={styles.assetBadge}>
          <Text style={styles.assetBadgeText}>{vehicles.length} ASSETS</Text>
        </View>
        {delayedCount > 0 ? (
          <View style={styles.delayBadge}>
            <Icon name="cloud-off" size={13} color={c.warning} />
            <Text style={styles.delayText}>{delayedCount} delayed</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.mapActions} pointerEvents="box-none">
        <TouchableOpacity style={styles.mapAction} onPress={onOpenMap} accessibilityRole="button" accessibilityLabel="Center live map">
          <Icon name="my-location" size={17} color={c.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mapAction} onPress={onOpenMap} accessibilityRole="button" accessibilityLabel="Open map layers">
          <Icon name="layers" size={17} color={c.text} />
        </TouchableOpacity>
      </View>

      {selectedVehicle ? (
        <View style={styles.telemetry}>
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleInfo}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: selectedColor }]} />
                <Text style={[styles.status, { color: selectedColor }]}>{selectedVehicle.displayState.replace("_", " ")}</Text>
                <Text style={styles.divider}>/</Text>
                <Text style={styles.location} numberOfLines={1}>{selectedVehicle.locationName ?? "LOCATION UNAVAILABLE"}</Text>
              </View>
              <View style={styles.identityRow}>
                <Text style={[styles.plate, mono]}>{selectedVehicle.plateNumber}</Text>
                <Text style={styles.model} numberOfLines={1}>{selectedVehicle.model || selectedVehicle.vehicleClass}</Text>
              </View>
              <Text style={styles.driver} numberOfLines={1}>Driver · {selectedVehicle.currentDriverName ?? "Unassigned"}</Text>
            </View>
            <TouchableOpacity style={styles.openButton} onPress={onOpenVehicle} accessibilityRole="button" accessibilityLabel={`Open ${selectedVehicle.plateNumber} details`}>
              <Icon name="open-in-new" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.metricsRow}>
            <TelemetryMetric label="SPEED" value={String(Math.round(selectedVehicle.speedKph ?? 0))} unit="km/h" />
            <View style={styles.metricWithFuel}>
              <TelemetryMetric label="FUEL" value={String(Math.round(selectedVehicle.fuelLevelPct ?? 0))} unit="%" />
              <View style={styles.fuelTrack}>
                <View style={[styles.fuelFill, { width: `${Math.max(0, Math.min(100, selectedVehicle.fuelLevelPct ?? 0))}%` }]} />
              </View>
            </View>
            <TelemetryMetric label="HOS LEFT" value={formatDuration(hosMinutesLeft)} />
            <TelemetryMetric label="ODOMETER" value={Math.round(selectedVehicle.odometerKm).toLocaleString()} unit="KM" />
          </View>
        </View>
      ) : (
        <View style={styles.noTelemetry}>
          <Icon name="location-searching" size={18} color={c.textMuted} />
          <View style={styles.noTelemetryCopy}>
            <Text style={styles.noTelemetryTitle}>Awaiting live telemetry</Text>
            <Text style={styles.noTelemetryBody}>Positioned vehicles will appear as data arrives.</Text>
          </View>
          <TouchableOpacity onPress={onOpenMap} accessibilityRole="button"><Text style={styles.openMapText}>Open map</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 344, overflow: "hidden", backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  mapScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,5,8,0.20)" },
  mapMeta: { position: "absolute", left: 12, top: 12, flexDirection: "row", gap: 6 },
  assetBadge: { minHeight: 28, justifyContent: "center", paddingHorizontal: 9, backgroundColor: "rgba(10,10,12,0.88)", borderWidth: 1, borderColor: c.border },
  assetBadgeText: { color: "#BFC0C7", fontSize: 9, fontWeight: "600", letterSpacing: 0.7 },
  delayBadge: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, backgroundColor: "rgba(251,191,36,0.08)", borderWidth: 1, borderColor: "rgba(251,191,36,0.32)" },
  delayText: { color: c.warning, fontSize: 9, fontWeight: "600" },
  mapActions: { position: "absolute", right: 12, top: 12, gap: 6 },
  mapAction: { width: 36, height: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10,10,12,0.88)", borderWidth: 1, borderColor: c.border },
  marker: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  telemetry: { position: "absolute", left: 12, right: 12, bottom: 12, padding: 12, backgroundColor: "rgba(18,18,22,0.94)", borderWidth: 1, borderColor: c.borderStrong },
  vehicleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  vehicleInfo: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  divider: { color: "rgba(255,255,255,0.25)", fontSize: 9 },
  location: { flex: 1, color: c.textMuted, fontSize: 9, letterSpacing: 0.3 },
  identityRow: { marginTop: 6, flexDirection: "row", alignItems: "baseline", gap: 8 },
  plate: { color: c.white, fontSize: 18, fontWeight: "700" },
  model: { flex: 1, color: "#A8A8AF", fontSize: 10 },
  driver: { marginTop: 4, color: c.textDim, fontSize: 10 },
  openButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border, backgroundColor: "rgba(255,255,255,0.035)" },
  metricsRow: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, flexDirection: "row" },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 7, borderRightWidth: 1, borderRightColor: c.border },
  metricWithFuel: { flex: 1, minWidth: 0 },
  metricLabel: { color: c.textDim, fontSize: 8, letterSpacing: 0.7 },
  metricValueRow: { marginTop: 4, flexDirection: "row", alignItems: "baseline", gap: 2 },
  metricValue: { color: c.white, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  metricUnit: { color: c.textDim, fontSize: 7 },
  fuelTrack: { height: 2, marginHorizontal: 7, marginTop: 5, backgroundColor: c.border },
  fuelFill: { height: 2, backgroundColor: c.info },
  noTelemetry: { position: "absolute", left: 12, right: 12, bottom: 12, minHeight: 72, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(18,18,22,0.94)", borderWidth: 1, borderColor: c.borderStrong },
  noTelemetryCopy: { flex: 1 },
  noTelemetryTitle: { color: c.text, fontSize: 12, fontWeight: "600" },
  noTelemetryBody: { marginTop: 3, color: c.textDim, fontSize: 9 },
  openMapText: { color: c.blueSoft, fontSize: 10, fontWeight: "600" },
});
