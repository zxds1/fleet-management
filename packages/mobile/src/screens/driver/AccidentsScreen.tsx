import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, spacing, typography, radius } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { StatusChip } from "../../components/StatusChip";
import { FleetButton } from "../../components/FleetButton";
import { AuthField } from "../../components/AuthField";
import { EmptyState } from "../../components/States";
import { Icon } from "../../components/Icon";
import { PhotoCapture } from "../../components/PhotoCapture";
import { fmtDateTime } from "../../utils/format";

const ACCIDENT_MEDIA_SLOTS = ["FRONT_DAMAGE", "REAR_DAMAGE", "SIDE_DAMAGE", "OTHER_VEHICLE_PLATE", "WITNESS", "ADDITIONAL"] as const;

export function AccidentsScreen({ navigation }: { navigation: any }) {
  const accidents = useStore(repository.accidentReports);
  const vehicles = useStore(repository.vehicles);
  const shift = useStore(repository.activeShift);

  const reportAccident = (mediaIds: string[]) => {
    repository.reportAccident(shift?.id ?? null, vehicles[0]?.id ?? null, "Reported from mobile", null, mediaIds);
  };

  const mayday = () => {
    repository.triggerMayday(shift?.id ?? null, vehicles[0]?.id ?? null, "Driver-initiated mayday");
  };

  return (
    <Screen>
      <ScreenHeader title="Accidents & Mayday" onBack={() => navigation.goBack()} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <FleetButton text="Report accident" onPress={() => navigation.navigate("accident_report")} />
        </View>
        <TouchableOpacity
          onPress={mayday}
          style={{
            flex: 1,
            backgroundColor: colors.primaryContainer,
            borderRadius: 0,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            borderWidth: 1,
            borderColor: colors.statusDanger,
          }}
        >
          <Icon name="warning" size={18} color={colors.statusDanger} />
          <Text style={{ color: colors.statusDanger, fontWeight: "700" }}>Mayday</Text>
        </TouchableOpacity>
      </View>

      {accidents.length === 0 ? (
        <EmptyState title="No accidents" message="Report an incident or raise a mayday from here." />
      ) : (
        accidents.map((a) => (
          <SectionCard key={a.id}>
            <TouchableOpacity onPress={() => navigation.navigate("driver_accident_detail", { id: a.id })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>
                  {a.isMayday ? "MAYDAY" : "Accident"}
                </Text>
                <StatusChip text={a.status} color={a.status === "RESOLVED" || a.status === "CLOSED" ? colors.statusSafe : colors.statusWarning} />
              </View>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 4 }]}>{fmtDateTime(a.createdAt)}</Text>
            </TouchableOpacity>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

export function AccidentReportScreen({ navigation }: { navigation: any }) {
  const vehicles = useStore(repository.vehicles);
  const shift = useStore(repository.activeShift);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [statement, setStatement] = useState("");
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [mediaSlot, setMediaSlot] = useState<(typeof ACCIDENT_MEDIA_SLOTS)[number]>(ACCIDENT_MEDIA_SLOTS[0]);
  const [submitted, setSubmitted] = useState(false);

  const addMedia = (mediaId: string) => {
    setMediaIds((m) => [...m, mediaId]);
  };

  const submit = () => {
    repository.reportAccident(shift?.id ?? null, vehicleId || null, statement || null, null, mediaIds);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Screen>
        <ScreenHeader title="Accident Report" onBack={() => navigation.goBack()} />
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>Accident reported</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>
            Your report has been queued. Dispatch will follow up. {mediaIds.length > 0 ? `${mediaIds.length} photo(s) attached.` : ""}
          </Text>
          <FleetButton text="Back to accidents" onPress={() => navigation.navigate("accidents")} style={{ marginTop: 16 }} />
        </SectionCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Report Accident" onBack={() => navigation.goBack()} />
      <SectionCard>
        <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Vehicle: {vehicles.find((v) => v.id === vehicleId)?.plateNumber ?? vehicleId}</Text>
        <View style={{ marginTop: spacing.md, gap: spacing.md }}>
          <View>
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Photo slot</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {ACCIDENT_MEDIA_SLOTS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setMediaSlot(s)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 0,
                    borderWidth: 1,
                    borderColor: mediaSlot === s ? colors.primary : colors.outlineVariant,
                    backgroundColor: mediaSlot === s ? colors.primaryContainer : colors.background,
                  }}
                >
                  <Text style={{ color: mediaSlot === s ? colors.onPrimary : colors.onSurface, fontSize: 12 }}>{s.replace(/_/g, " ")}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <PhotoCapture
            label={`Add photo (${mediaSlot.replace(/_/g, " ")})`}
            mediaId={mediaIds.length > 0 ? (mediaIds[mediaIds.length - 1] ?? "") : ""}
            onChangeMediaId={addMedia}
          />
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{mediaIds.length} photo(s) captured</Text>
          <AuthField value={statement} onChangeText={setStatement} label="Driver statement" placeholder="Describe what happened" />
        </View>
        <FleetButton text="Submit accident report" onPress={submit} enabled={statement.length > 0 && mediaIds.length > 0} style={{ marginTop: spacing.md }} />
      </SectionCard>
    </Screen>
  );
}

export function MyAccidentsScreen({ navigation }: { navigation: any }) {
  const accidents = useStore(repository.accidentReports);
  return (
    <Screen>
      <ScreenHeader title="My Accidents" onBack={() => navigation.goBack()} />
      {accidents.length === 0 ? (
        <EmptyState title="Nothing reported" message="Your accident and mayday reports appear here." />
      ) : (
        accidents.map((a) => (
          <SectionCard key={a.id}>
            <TouchableOpacity onPress={() => navigation.navigate("driver_accident_detail", { id: a.id })}>
              <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{a.isMayday ? "MAYDAY" : "Accident"}</Text>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{fmtDateTime(a.createdAt)} · {a.status}</Text>
            </TouchableOpacity>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

export function DriverAccidentDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const accidents = useStore(repository.accidentReports);
  const a = accidents.find((x) => x.id === route.params?.id);
  return (
    <Screen>
      <ScreenHeader title="Accident Detail" onBack={() => navigation.goBack()} />
      {!a ? (
        <EmptyState title="Not found" message="This report is no longer available." />
      ) : (
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{a.isMayday ? "Mayday alert" : "Accident report"}</Text>
          <StatusChip text={a.status} color={colors.statusWarning} />
          <Text style={[typography.bodyMedium, { color: colors.onSurface, marginTop: 12 }]}>Tier: {a.tierLevel}</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurface }]}>Acknowledged: {a.acknowledged ? "yes" : "no"}</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurface }]}>Escalation armed: {a.escalationArmed ? "yes" : "no"}</Text>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 8 }]}>{a.driverStatement ?? "No statement provided."}</Text>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{fmtDateTime(a.createdAt)}</Text>
          {a.mediaSlots && a.mediaSlots.length > 0 ? (
            <View style={{ marginTop: spacing.md, gap: 6 }}>
              <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>Media slots:</Text>
              {a.mediaSlots.map((slot) => (
                <StatusChip key={slot} text={slot} color={colors.statusInfo} />
              ))}
            </View>
          ) : null}
        </SectionCard>
      )}
    </Screen>
  );
}
