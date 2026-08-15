import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { colors, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { EmptyState } from "../../components/States";

export function TrainingHubScreen({ navigation }: { navigation: any }) {
  const lessons = useStore(repository.trainingLessons);
  return (
    <Screen>
      <ScreenHeader title="Training Hub" onBack={() => navigation.goBack()} />
      {lessons.length === 0 ? (
        <EmptyState title="No lessons" message="Assigned training appears here." />
      ) : (
        lessons.map((l) => (
          <SectionCard key={l.id}>
            <TouchableOpacity
              onPress={() => navigation.navigate("lesson_detail", { id: l.id })}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyLarge, { color: colors.onSurface, fontWeight: "600" }]}>{l.title}</Text>
                <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{l.category} · {l.durationMinutes}m</Text>
              </View>
              <Text style={{ color: l.isCompleted ? colors.statusSafe : colors.onSurfaceVariant, fontSize: 12 }}>
                {l.isCompleted ? "Done" : `${l.progressPct}%`}
              </Text>
            </TouchableOpacity>
          </SectionCard>
        ))
      )}
    </Screen>
  );
}

