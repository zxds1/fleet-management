import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ENDPOINTS, url } from '../../api/endpoints';
import { api } from '../../services';
import { VehicleIssueCategorySchema, VehicleIssueCreateSchema, VehicleIssueListRowSchema, VehicleIssueOutcomeSchema, type VehicleIssueCategory, type VehicleIssueCreateInput, type VehicleIssueSeverity } from '@fleet/shared';
import { Body, Button, Card, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { color, space } from '../../design/tokens';
import { useCan } from '../../state/store';

export function VehicleIssuesScreen({ route }: any) {
  const { t } = useTranslation();
  const { vehicleId } = route.params;
  const qc = useQueryClient();
  const canReport = useCan('vehicle:report');

  const { data: page, isLoading } = useQuery({
    queryKey: ['vehicle-issues', vehicleId],
    queryFn: () => api.get(url(ENDPOINTS.vehicleIssues, { vehicleId }), { schema: z.array(VehicleIssueListRowSchema) }),
    staleTime: 30_000,
  });

  const issues = page ?? [];

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<VehicleIssueCategory>('MECHANICAL');
  const [severity, setSeverity] = useState<VehicleIssueSeverity>('MEDIUM');
  const [description, setDescription] = useState('');

  const reportMutation = useMutation({
    mutationFn: (body: VehicleIssueCreateInput) => api.post(url(ENDPOINTS.reportVehicleIssue, { vehicleId }), { body, schema: VehicleIssueOutcomeSchema }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vehicle-issues', vehicleId] });
      setShowForm(false);
      setDescription('');
    },
  });

  const handleSubmit = async () => {
    if (!description.trim()) return;
    await reportMutation.mutateAsync({ category, severity, description });
  };

  const cats: VehicleIssueCategory[] = ['MECHANICAL', 'ELECTRICAL', 'TYRE', 'BODY', 'OTHER'];
  const sevs: VehicleIssueSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

  return (
    <Screen offlineTag>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('vehicle.issues')}</Title>
        {canReport ? <Button tone="quiet" label={t('vehicle.reportIssue')} onPress={() => setShowForm(true)} /> : null}
      </View>

      {showForm ? (
        <Card>
          <Field label={t('issue.category')} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.sm }}>
            {cats.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)} style={{ padding: space.sm, borderRadius: 8, backgroundColor: category === c ? color.verge : color.line }}>
                <Body style={{ color: category === c ? color.paper : color.asphalt }}>{t(`issue.category.${c.toLowerCase()}`)}</Body>
              </Pressable>
            ))}
          </View>
          <Field label={t('issue.severity')} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginVertical: space.sm }}>
            {sevs.map((s) => (
              <Pressable key={s} onPress={() => setSeverity(s)} style={{ padding: space.sm, borderRadius: 8, backgroundColor: severity === s ? color.verge : color.line }}>
                <Body style={{ color: severity === s ? color.paper : color.asphalt }}>{t(`issue.severity.${s.toLowerCase()}`)}</Body>
              </Pressable>
            ))}
          </View>
          <Field label={t('issue.description')} value={description} onChange={setDescription} placeholder={t('issue.descriptionPlaceholder')} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button tone="quiet" label={t('actions.cancel')} onPress={() => setShowForm(false)} />
            <Button label={t('actions.submit')} busy={reportMutation.isPending} onPress={handleSubmit} />
          </View>
        </Card>
      ) : null}

      {isLoading ? <Body dim>{t('state.loading')}</Body> : null}
      {issues.length === 0 && !isLoading ? <Body dim>{t('vehicle.noIssues')}</Body> : null}
      {issues.map((i) => (
        <Card key={i.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: 'bold' }}>{i.category}</Body>
            <Body dim>{i.created_at}</Body>
          </View>
          <Body>{i.description}</Body>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Body dim>{t('issue.status')}: {i.status}</Body>
            <Body dim>{t('issue.severity')}: {i.severity}</Body>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
