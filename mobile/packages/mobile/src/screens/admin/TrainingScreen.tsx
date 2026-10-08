import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Title, Body } from '../../design/components';
import { Screen } from '../../design/Screen';
import { space } from '../../design/tokens';
import { useTrainingLessons, useTrainingLessonDetail, useTrainingRoster, useCompleteTrainingLesson } from '../../queries';
import { useCan } from '../../state/store';
import { goto } from '../../navigation/ref';

export function TrainingScreen() {
  const { t } = useTranslation();
  const canRead = useCan('training:read');
  const canReview = useCan('training:review');
  const canComplete = useCan('training:complete');
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);

  return (
    <Screen offlineTag>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('training.title')}</Title>
        {canReview ? <Button tone="quiet" label={t('training.roster')} onPress={() => goto('TrainingRoster')} /> : null}
      </View>
      <LessonsList canRead={canRead} onSelect={setSelectedLesson} selectedId={selectedLesson} canComplete={canComplete} />
      {selectedLesson && canRead ? <LessonDetail id={selectedLesson} canComplete={canComplete} /> : null}
    </Screen>
  );
}

function LessonsList({ canRead, onSelect, selectedId, canComplete }: { canRead: boolean; onSelect: (id: string) => void; selectedId: string | null; canComplete: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useTrainingLessons();
  if (!canRead) return <Body dim>{t('state.loading')}</Body>;
  if (isLoading) return <Body dim>{t('state.loading')}</Body>;
  if (error) return <Body dim>{error.message}</Body>;
  const items = data?.data ?? [];
  return items.map((l: any) => (
    <Card key={l.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: 'bold' }}>{l.title}</Body>
        {l.is_mandatory ? <Body dim>{t('training.mandatory')}</Body> : null}
      </View>
      <Body dim>{l.course_title}</Body>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Button tone="quiet" label={t('training.viewDetail')} onPress={() => onSelect(l.id)} />
      </View>
    </Card>
  ));
}

function LessonDetail({ id, canComplete }: { id: string; canComplete: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useTrainingLessonDetail(id);
  const complete = useCompleteTrainingLesson();
  if (isLoading) return <Body dim>{t('state.loading')}</Body>;
  if (error) return <Body dim>{error.message}</Body>;
  if (!data) return null;
  return (
    <Card>
      <Title>{data.title}</Title>
      <Body dim>{data.description}</Body>
      <Body dim>{t('training.duration')}: {data.duration_minutes ?? '–'} {t('training.minutes')}</Body>
      {canComplete ? (
        <Button label={t('training.complete')} onPress={() => void complete.mutateAsync({ lessonId: id, body: {} })} busy={complete.isPending} />
      ) : null}
    </Card>
  );
}

export function TrainingRosterScreen() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useTrainingRoster();
  return (
    <Screen offlineTag>
      <Title>{t('training.roster')}</Title>
      {isLoading ? <Body dim>{t('state.loading')}</Body> : null}
      {error ? <Body dim>{error.message}</Body> : null}
      {(data?.data ?? []).map((r: any) => (
        <Card key={r.id}>
          <Body style={{ fontWeight: 'bold' }}>{r.driver_name ?? r.driver_id}</Body>
          <Body dim>{r.lesson_title} — {t(`training.status.${r.status?.toLowerCase() ?? 'unknown'}`)}</Body>
          {r.completed_at ? <Body dim>{t('training.completedAt')}: {r.completed_at}</Body> : null}
        </Card>
      ))}
    </Screen>
  );
}
