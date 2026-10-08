import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Title, Body } from '../../design/components';
import { Screen } from '../../design/Screen';
import { space } from '../../design/tokens';
import { useExportRequests, useCreateExportRequest, useTenantPrivacyRequests, useCreateDeletionRequest } from '../../queries';
import { useCan } from '../../state/store';

export function PrivacyScreen() {
  const { t } = useTranslation();
  const canRequest = useCan('privacy:request_own');

  return (
    <Screen offlineTag>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('privacy.title')}</Title>
      </View>

      {canRequest ? (
        <Card>
          <Title>{t('privacy.requestExport')}</Title>
          <Body dim>{t('privacy.exportHelp')}</Body>
          <CreateExportForm />
        </Card>
      ) : null}

      <Body style={{ marginTop: space.sm }}>{t('privacy.myRequests')}</Body>
      <ExportRequestsList />

      <TenantPrivacyRequests />
    </Screen>
  );
}

function CreateExportForm() {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const create = useCreateExportRequest();
  const handleSubmit = async () => {
    await create.mutateAsync({ notes: notes || undefined });
    setNotes('');
  };
  return (
    <>
      <Field label={t('privacy.notes')} value={notes} onChange={setNotes} placeholder={t('privacy.notesPlaceholder')} />
      <Button label={t('privacy.submit')} busy={create.isPending} onPress={handleSubmit} />
    </>
  );
}

function ExportRequestsList() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useExportRequests();
  if (isLoading) return <Body dim>{t('state.loading')}</Body>;
  if (error) return <Body dim>{error.message}</Body>;
  const items = data?.data ?? [];
  if (items.length === 0) return <Body dim>{t('privacy.noRequests')}</Body>;
  return items.map((r: any) => (
    <Card key={r.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: 'bold' }}>{r.request_type}</Body>
        <Body dim>{r.status}</Body>
      </View>
      <Body dim>{t('privacy.createdAt')}: {r.created_at}</Body>
      {r.notes ? <Body dim>{r.notes}</Body> : null}
    </Card>
  ));
}

function TenantPrivacyRequests() {
  const { t } = useTranslation();
  const canViewTenant = useCan('privacy:view_requests_tenant');
  if (!canViewTenant) return null;
  const { data, isLoading, error } = useTenantPrivacyRequests();
  return (
    <>
      <Title style={{ marginTop: space.sm }}>{t('privacy.tenantRequests')}</Title>
      {isLoading ? <Body dim>{t('state.loading')}</Body> : null}
      {error ? <Body dim>{error.message}</Body> : null}
      {(data?.data ?? []).map((r: any) => (
        <Card key={r.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: 'bold' }}>{r.request_type}</Body>
            <Body dim>{r.status}</Body>
          </View>
          <Body dim>{r.created_at}</Body>
        </Card>
      ))}
    </>
  );
}
