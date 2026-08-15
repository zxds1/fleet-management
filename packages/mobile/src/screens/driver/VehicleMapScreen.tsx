import React from "react";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { View, Text, StyleSheet } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { displayStateColor } from "../../theme/colors";
import { EmptyState } from "../../components/States";

/** Mirrors FleetMap.kt — every positioned vehicle rendered as a colored marker. */
export function VehicleMapScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const positioned = vehicles.filter((v) => v.lat != null && v.lng != null);

  const first = positioned[0];
  const initialRegion = first
    ? {
        latitude: first.lat!,
        longitude: first.lng!,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }
    : { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 4, longitudeDelta: 4 };

  return (
    <Screen scroll={false}>
      <ScreenHeader title="Vehicle Map" onBack={() => navigation.goBack()} />
      {positioned.length === 0 ? (
        <EmptyState title="No positions" message="Vehicles with live GPS will appear on the map." />
      ) : (
        <MapView
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          initialRegion={initialRegion}
          showsUserLocation={false}
        >
          {positioned.map((v) => (
            <Marker
              key={v.id}
              coordinate={{ latitude: v.lat!, longitude: v.lng! }}
              title={v.plateNumber}
              description={`${v.model} · ${v.displayState}`}
              pinColor={displayStateColor(v.displayState)}
            />
          ))}
        </MapView>
      )}
    </Screen>
  );
}

