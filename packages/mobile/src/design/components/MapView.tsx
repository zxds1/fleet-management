// packages/mobile/src/design/components/MapView.tsx
//
// Map surface for the driver "My Vehicle" and admin "Live Map". Native tiles (react-native-maps)
// are wired in Phase 3; this is the offline-safe placeholder + the marker rendering contract.
// Per driver caching rules, when offline we only show the last cached region (no network tiles).

import React from "react";
import { View, Text as RNText } from "react-native";
import { theme } from "../theme";
import { Text } from "./Text";
import { t } from "@/core/i18n";

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Display-state precedence color (N5) for the pin. */
  state?: import("../tokens").DisplayState;
  label?: string;
  /** Tapping the marker opens the vehicle detail (admin Live Map). */
  onPress?: () => void;
}

export interface MapViewProps {
  markers?: MapMarker[];
  online?: boolean;
  /** True on admin tablet — wider chrome. */
  variant?: "driver" | "admin";
  testID?: string;
}

export function MapView({ markers = [], online = true, variant = "driver", testID }: MapViewProps) {
  return (
    <View
      testID={testID ?? "map-view"}
      style={{
        flex: 1,
        backgroundColor: theme.colors.ui03,
        borderWidth: 1,
        borderColor: theme.colors.ui03,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <RNText style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing[2] }}>
        {markers.length} {markers.length === 1 ? "vehicle" : "vehicles"}
      </RNText>
      {!online && <Text style={{ color: theme.colors.textSecondary }}>{t("driver.vehicle.offlineMapNotice")}</Text>}
    </View>
  );
}
