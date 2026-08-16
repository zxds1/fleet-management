import React from "react";
import { useState } from "react";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Icon } from "../../components/Icon";
import { MapMarker } from "../../components/MapMarker";
import { MapControls, MapControlButton } from "../../components/MapControls";
import { displayStateColor } from "../../theme/colors";
import { commandColors as c, darkMapStyle, commandSpacing, mono } from "../../screens/admin/commandCenterTheme";

function regionFor(vehicles: { lat?: number | null; lng?: number | null }[]): Region {
  const positioned = vehicles.filter((v) => v.lat != null && v.lng != null);
  if (positioned.length === 0) {
    return { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.5, longitudeDelta: 0.5 };
  }

  const latitudes = positioned.map((v) => v.lat!);
  const longitudes = positioned.map((v) => v.lng!);
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

export function VehicleMapScreen({ navigation }: { navigation: any }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const vehicles = [
    {
      id: "demo-1",
      lat: -1.2921,
      lng: 36.8219,
      plateNumber: "KCT 1234",
      displayState: "MOVING" as const,
      model: "Toyota Hilux",
      vehicleClass: "Light Truck",
      currentDriverName: "J. Doe",
      locationName: "Mombasa Rd",
      speedKph: 65,
      fuelLevelPct: 72,
      odometerKm: 45230,
    },
  ];

  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) ?? vehicles[0] : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vehicle Map</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.mapContainer}>
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          initialRegion={regionFor(vehicles)}
          customMapStyle={darkMapStyle}
          showsCompass={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
        >
          {vehicles.map((v) => {
            const markerColor = displayStateColor(v.displayState);
            const isSelected = selected?.id === v.id;
            return (
              <Marker
                key={v.id}
                coordinate={{ latitude: v.lat!, longitude: v.lng! }}
                onPress={(event) => {
                  event.stopPropagation();
                  setSelectedId(v.id);
                }}
                tracksViewChanges={isSelected}
              >
                <MapMarker color={markerColor} selected={isSelected} />
              </Marker>
            );
          })}
        </MapView>

        <View style={styles.mapScrim} pointerEvents="none" />
        <MapControls>
          <MapControlButton icon="my-location" onPress={() => {}} accessibilityLabel="Center live map" />
          <MapControlButton icon="layers" onPress={() => {}} accessibilityLabel="Open map layers" />
        </MapControls>

        {selected ? (
          <View style={styles.telemetry}>
            <View style={styles.vehicleRow}>
              <View style={styles.vehicleInfo}>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: displayStateColor(selected.displayState) }]} />
                  <Text style={[styles.status, { color: displayStateColor(selected.displayState) }]}>
                    {selected.displayState.replace("_", " ")}
                  </Text>
                  <Text style={styles.divider}>/</Text>
                  <Text style={styles.location} numberOfLines={1}>
                    {selected.locationName ?? "LOCATION UNAVAILABLE"}
                  </Text>
                </View>
                <View style={styles.identityRow}>
                  <Text style={[styles.plate, mono]}>{selected.plateNumber}</Text>
                  <Text style={styles.model} numberOfLines={1}>
                    {selected.model} · {selected.vehicleClass}
                  </Text>
                </View>
                <Text style={styles.driver} numberOfLines={1}>
                  Driver · {selected.currentDriverName ?? "Unassigned"}
                </Text>
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>SPEED</Text>
                <View style={styles.metricValueRow}>
                  <Text style={[styles.metricValue, mono]}>{Math.round(selected.speedKph ?? 0)}</Text>
                  <Text style={styles.metricUnit}>km/h</Text>
                </View>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>FUEL</Text>
                <View style={styles.metricValueRow}>
                  <Text style={[styles.metricValue, mono]}>{Math.round(selected.fuelLevelPct ?? 0)}</Text>
                  <Text style={styles.metricUnit}>%</Text>
                </View>
                <View style={styles.fuelTrack}>
                  <View style={[styles.fuelFill, { width: `${Math.max(0, Math.min(100, selected.fuelLevelPct ?? 0))}%` }]} />
                </View>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>ODOMETER</Text>
                <View style={styles.metricValueRow}>
                  <Text style={[styles.metricValue, mono]}>{Math.round(selected.odometerKm).toLocaleString()}</Text>
                  <Text style={styles.metricUnit}>KM</Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.noTelemetry}>
            <Icon name="location-searching" size={18} color={c.textDim} />
            <View style={styles.noTelemetryCopy}>
              <Text style={styles.noTelemetryTitle}>Awaiting live telemetry</Text>
              <Text style={styles.noTelemetryBody}>Positioned vehicles will appear as data arrives.</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
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
  mapContainer: { flex: 1, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
  mapScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,5,8,0.20)" },
  telemetry: {
    position: "absolute",
    left: commandSpacing.lg,
    right: commandSpacing.lg,
    bottom: commandSpacing.lg,
    padding: commandSpacing.md,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  vehicleRow: { flexDirection: "row", alignItems: "flex-start", gap: commandSpacing.sm },
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
  metricsRow: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, flexDirection: "row" },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 7 },
  metricLabel: { color: c.textDim, fontSize: 8, letterSpacing: 0.7 },
  metricValueRow: { marginTop: 4, flexDirection: "row", alignItems: "baseline", gap: 2 },
  metricValue: { color: c.white, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  metricUnit: { color: c.textDim, fontSize: 7 },
  fuelTrack: { height: 2, marginHorizontal: 7, marginTop: 5, backgroundColor: c.border },
  fuelFill: { height: 2, backgroundColor: c.info },
  noTelemetry: {
    position: "absolute",
    left: commandSpacing.lg,
    right: commandSpacing.lg,
    bottom: commandSpacing.lg,
    minHeight: 72,
    padding: commandSpacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: commandSpacing.sm,
    backgroundColor: "rgba(18,18,22,0.94)",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  noTelemetryCopy: { flex: 1 },
  noTelemetryTitle: { color: c.text, fontSize: 12, fontWeight: "600" },
  noTelemetryBody: { marginTop: 3, color: c.textDim, fontSize: 9 },
});
