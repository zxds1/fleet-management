import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { AuthField } from "../../components/AuthField";
import { PhotoCapture } from "../../components/PhotoCapture";

export function RefuelScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const shift = useStore(repository.activeShift);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [odometer, setOdometer] = useState("");
  const [receiptMediaId, setReceiptMediaId] = useState("");
  const [odometerPhotoMediaId, setOdometerPhotoMediaId] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [done, setDone] = useState(false);

  const submit = () => {
    repository.submitRefuel(
      vehicleId || "unknown",
      shift?.id ?? null,
      Number(odometer) || 0,
      receiptMediaId || "media_receipt",
      odometerPhotoMediaId || "media_odometer",
      new Date().toISOString(),
      cardLast4 || undefined,
    );
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Refuel queued</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>
            Photo-first refuel submitted. OCR will parse the receipt and an admin verifies it.
          </Text>
          <FleetButton text="Done" onPress={() => navigation.navigate("home")} style={{ marginTop: 16 }} />
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Refuel (photo-first)</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          <AuthField value={vehicleId} onChangeText={setVehicleId} label="Vehicle id" placeholder="vehicle-123" />
          <AuthField value={odometer} onChangeText={setOdometer} label="Odometer reading (km)" keyboardType="number-pad" />
          <PhotoCapture
            label="Receipt photo"
            required
            mediaId={receiptMediaId}
            onChangeMediaId={setReceiptMediaId}
          />
          <PhotoCapture
            label="Odometer photo"
            required
            mediaId={odometerPhotoMediaId}
            onChangeMediaId={setOdometerPhotoMediaId}
          />
          <AuthField
            value={cardLast4}
            onChangeText={(t) => setCardLast4(t.replace(/[^0-9]/g, "").slice(0, 4))}
            label="Fuel card last 4 (optional)"
            keyboardType="number-pad"
          />
        </View>
        <FleetButton
          text="Submit refuel"
          onPress={submit}
          enabled={odometer.length > 0 && receiptMediaId.length > 0 && odometerPhotoMediaId.length > 0}
          style={{ marginTop: spacing.md }}
        />
      </SectionCard>
    </Screen>
  );
}
