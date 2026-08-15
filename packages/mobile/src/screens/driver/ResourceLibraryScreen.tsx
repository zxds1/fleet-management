import React from "react";
import { View, Text } from "react-native";
import { colors, typography } from "../../theme";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";

const RESOURCES = [
  { title: "Driver handbook", subtitle: "Company policy and conduct" },
  { title: "HOS rules", subtitle: "Hours-of-service quick reference" },
  { title: "Defensive driving", subtitle: "Safety briefing" },
  { title: "Emergency procedures", subtitle: "Accident & mayday playbook" },
];

export function ResourceLibraryScreen({ navigation }: { navigation: any }) {
  return (
    <Screen>
      <ScreenHeader title="Resource Library" onBack={() => navigation.goBack()} />
      {RESOURCES.map((r) => (
        <SectionCard key={r.title}>
          <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{r.title}</Text>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{r.subtitle}</Text>
        </SectionCard>
      ))}
    </Screen>
  );
}

