import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors, spacing, typography } from "../../theme";
import { repository } from "../../repo/FleetRepository";
import { useStore } from "../../store";
import { Screen, ScreenHeader } from "../../components/Screen";
import { SectionCard } from "../../components/SectionCard";
import { FleetButton } from "../../components/FleetButton";
import { EmptyState } from "../../components/States";

export function LessonDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const lessons = useStore(repository.trainingLessons);
  const lesson = lessons.find((l) => l.id === route.params?.id);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const complete = async () => {
    if (!lesson) return;
    setBusy(true);
    try {
      await repository.completeTrainingLesson(lesson.id);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Lesson" onBack={() => navigation.goBack()} />
      {!lesson ? (
        <EmptyState title="Not found" message="This lesson is unavailable." />
      ) : (
        <SectionCard>
          <Text style={[typography.titleMedium, { color: colors.onSurface }]}>{lesson.title}</Text>
          <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant }]}>{lesson.category} · {lesson.durationMinutes} minutes</Text>
          <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginTop: 12 }]}>
            Lesson content is delivered by the training service. Complete it to record progress against your profile.
          </Text>
          {done ? (
            <Text style={{ color: colors.statusSafe, marginTop: 16, fontWeight: "600" }}>Completed</Text>
          ) : (
            <FleetButton text="Mark complete" onPress={complete} enabled={!busy} style={{ marginTop: 16 }} />
          )}
        </SectionCard>
      )}
    </Screen>
  );
}

