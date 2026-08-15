import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography, radius } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { AuthField } from "../../components/AuthField";
import { PhotoCapture } from "../../components/PhotoCapture";

const GAUGES = ["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"] as const;

export function ClockOutScreen({ navigation }: { navigation: any }) {
  const shift = useStore(repository.activeShift);
  const [odometer, setOdometer] = useState("");
  const [gauge, setGauge] = useState<(typeof GAUGES)[number]>("HALF");
  const [photoMediaId, setPhotoMediaId] = useState("");
  const [done, setDone] = useState(false);

  const submit = () => {
    repository.clockOut(shift?.id ?? "unknown", Number(odometer) || 0, gauge, photoMediaId || "media_placeholder");
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Clock-out queued</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>
            Your shift closeout was queued for sync. Open the Outbox to watch it drain.
          </Text>
          <FleetButton text="Back to home" onPress={() => navigation.navigate("home")} style={{ marginTop: 16 }} />
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Clock Out</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          <AuthField value={odometer} onChangeText={setOdometer} label="End odometer (km)" keyboardType="number-pad" />
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>End fuel gauge</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {GAUGES.map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => setGauge(g)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 0,
                  borderWidth: 1,
                  borderColor: gauge === g ? colors.primary : colors.outlineVariant,
                  backgroundColor: gauge === g ? colors.primaryContainer : colors.background,
                }}
              >
                <Text style={{ color: colors.onSurface, fontSize: 12 }}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <PhotoCapture
            label="Cabin photo (end)"
            mediaId={photoMediaId}
            onChangeMediaId={setPhotoMediaId}
          />
        </View>
        <FleetButton text="Clock Out" onPress={submit} enabled={odometer.length > 0} style={{ marginTop: spacing.md }} />
      </SectionCard>
    </Screen>
  );
}
