import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";

const STEPS = [
  { title: "Welcome", body: "FleetPulse helps you stay compliant and safe on every trip." },
  { title: "Shifts", body: "Clock in and out from the home screen. Your HOS is tracked automatically." },
  { title: "DVIR", body: "Complete a daily vehicle inspection before driving. Defects block your next shift." },
  { title: "Stay safe", body: "Use Mayday for emergencies. Your location is shared with dispatch." },
];

export function OnboardingScreens({ navigation }: { navigation: any }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  if (!step) return null;
  return (
    <Screen>
      <ScreenHeader title="Onboarding" onBack={() => navigation.goBack()} />
      <SectionCard>
        <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{step.title}</Text>
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 8 }]}>{step.body}</Text>
      </SectionCard>
      <FleetButton
        text={last ? "Get started" : "Next"}
        onPress={() => (last ? navigation.goBack() : setI(i + 1))}
      />
      {!last ? (
        <FleetButton text="Skip" onPress={() => navigation.goBack()} isPrimary={false} />
      ) : null}
    </Screen>
  );
}

