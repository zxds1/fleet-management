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
import { Icon } from "../../components/Icon";

const TEMPLATE = [
  { id: "t_brakes", label: "Brakes", category: "SAFETY" },
  { id: "t_tires", label: "Tires", category: "SAFETY" },
  { id: "t_lights", label: "Lights", category: "SAFETY" },
  { id: "t_fluid", label: "Fluid leaks", category: "SAFETY" },
  { id: "t_body", label: "Body / mirrors", category: "CONDITION" },
];

const RESULTS = ["PASS", "FAIL", "NOT_APPLICABLE"] as const;

export function InspectionScreen({ navigation }: { navigation: any }) {
  const shift = useStore(repository.activeShift);
  const vehicles = useStore(repository.vehicles);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? null);
  const [results, setResults] = useState<Record<string, (typeof RESULTS)[number]>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [defectNotes, setDefectNotes] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState("");
  const [done, setDone] = useState(false);

  const defects = Object.values(results).filter((r) => r === "FAIL").length;

  const submit = () => {
    const items = TEMPLATE.map((t) => ({
      templateItemId: t.id,
      result: results[t.id] ?? "PASS",
      notes: defectNotes[t.id] ?? null,
      photo_media_object_id: photos[t.id] ?? null,
    }));
    repository.submitDvir(shift?.id ?? "unknown", "tmpl_daily", "VEHICLE", vehicleId, items, signature || "Driver");
    setDone(true);
  };

  const setResult = (itemId: string, result: (typeof RESULTS)[number]) => {
    setResults((s) => ({ ...s, [itemId]: result }));
  };

  const setPhoto = (itemId: string, mediaId: string) => {
    setPhotos((p) => ({ ...p, [itemId]: mediaId }));
  };

  const setNote = (itemId: string, text: string) => {
    setDefectNotes((n) => ({ ...n, [itemId]: text }));
  };

  if (done) {
    return (
      <Screen>
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>DVIR submitted</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>
            {defects > 0 ? `${defects} defect(s) flagged — these block your next shift until reviewed.` : "No defects. Safe to continue."}
          </Text>
          <FleetButton text="Done" onPress={() => navigation.navigate("dvir_list")} style={{ marginTop: 16 }} />
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>DVIR Inspection</Text>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>Vehicle: {vehicles.find((v) => v.id === vehicleId)?.plateNumber ?? "—"}</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          {TEMPLATE.map((t) => (
            <View key={t.id}>
              <Text style={[typography.bodyMedium, { color: colors.onSurface }]}>{t.label}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                {RESULTS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setResult(t.id, r)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 0,
                      borderWidth: 1,
                      borderColor: results[t.id] === r ? colors.primary : colors.outlineVariant,
                      backgroundColor: results[t.id] === r ? colors.primaryContainer : colors.background,
                    }}
                  >
                    <Text style={{ color: results[t.id] === r ? colors.onPrimary : colors.onSurface, fontSize: 12 }}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {results[t.id] === "FAIL" ? (
                <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                  <AuthField
                    value={defectNotes[t.id] ?? ""}
                    onChangeText={(v) => setNote(t.id, v)}
                    label="Defect notes"
                    placeholder="Describe the issue"
                  />
                  <PhotoCapture
                    label="Defect photo evidence"
                    mediaId={photos[t.id] ?? ""}
                    onChangeMediaId={(id) => setPhoto(t.id, id)}
                  />
                </View>
              ) : null}
            </View>
          ))}
          <AuthField value={signature} onChangeText={setSignature} label="Signature" placeholder="Driver name" />
        </View>
        <FleetButton text="Submit DVIR" onPress={submit} enabled={signature.length > 0} style={{ marginTop: spacing.md }} />
      </SectionCard>
    </Screen>
  );
}
