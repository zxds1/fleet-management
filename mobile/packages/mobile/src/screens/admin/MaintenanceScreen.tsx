import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Title, Body } from '../../design/components';
import { Screen } from '../../design/Screen';
import { space } from '../../design/tokens';
import { useMaintenanceList, useMaintenanceDetail, useCreateMaintenanceRecord } from '../../queries';
import { useCan } from '../../state/store';
import { fmtDateTime } from '../../format';

export function MaintenanceScreen() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Screen offlineTag>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('maintenance.title')}</Title>
        <CreateMaintenanceForm />
      </View>
      <MaintenanceList onSelect={setSelectedId} selectedId={selectedId} />
      {selectedId ? <MaintenanceDetail id={selectedId} /> : null}
    </Screen>
  );
}

function MaintenanceList({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string | null }) {
  const { t } = useTranslation();
  const canRead = useCan('maintenance:read');
  const { data, isLoading, error } = useMaintenanceList();
  if (!canRead) return <Body dim>{t('state.loading')}</Body>;
  if (isLoading) return <Body dim>{t('state.loading')}</Body>;
  if (error) return <Body dim>{error.message}</Body>;
  const items = data?.data ?? [];
  return items.map((m: any) => (
    <Card key={m.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: 'bold' }}>{m.task_id}</Body>
        <Body dim>{fmtDateTime(m.performed_at)}</Body>
      </View>
      <Body dim>{t('maintenance.vendor')}: {m.vendor ?? '–'}</Body>
      {m.cost != null ? <Body dim>{t('maintenance.cost')}: {m.cost} {m.currency}</Body> : null}
      <Button tone="quiet" label={t('maintenance.viewDetail')} onPress={() => onSelect(m.id)} />
    </Card>
  ));
}

function MaintenanceDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useMaintenanceDetail(id);
  if (isLoading) return <Body dim>{t('state.loading')}</Body>;
  if (error) return <Body dim>{error.message}</Body>;
  if (!data) return null;
  return (
    <Card>
      <Title>{data.task_id}</Title>
      <Body dim>{fmtDateTime(data.performed_at)}</Body>
      {data.vehicle_id ? <Body dim>{t('maintenance.vehicleId')}: {data.vehicle_id}</Body> : null}
      {data.odometer_km != null ? <Body dim>{t('shift.odometer')}: {data.odometer_km}</Body> : null}
      {data.vendor ? <Body dim>{t('maintenance.vendor')}: {data.vendor}</Body> : null}
      {data.cost != null ? <Body dim>{t('maintenance.cost')}: {data.cost} {data.currency}</Body> : null}
      {data.notes ? <Body>{data.notes}</Body> : null}
    </Card>
  );
}

function CreateMaintenanceForm() {
  const { t } = useTranslation();
  const canCreate = useCan('maintenance:record');
  const [show, setShow] = useState(false);
  if (!canCreate) return null;
  if (!show) return <Button tone="quiet" label={t('maintenance.record')} onPress={() => setShow(true)} />;
  return <CreateMaintenanceRecordInternal onClose={() => setShow(false)} />;
}

function CreateMaintenanceRecordInternal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const create = useCreateMaintenanceRecord();
  const [taskCode, setTaskCode] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [vendor, setVendor] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async () => {
    await create.mutateAsync({
      vehicle_id: vehicleId || undefined,
      task_code: taskCode,
      performed_at: new Date().toISOString(),
      vendor: vendor || undefined,
      cost: cost ? Number(cost) : undefined,
      currency: 'KES',
      notes: notes || undefined,
    });
    onClose();
  };

  return (
    <Card>
      <Field label={t('maintenance.taskId')} value={taskCode} onChange={setTaskCode} placeholder={t('maintenance.taskId')} />
      <Field label={t('maintenance.vehicleId')} value={vehicleId} onChange={setVehicleId} placeholder={t('maintenance.vehicleId')} />
      <Field label={t('maintenance.vendor')} value={vendor} onChange={setVendor} placeholder={t('maintenance.vendor')} />
      <Field label={t('maintenance.cost')} value={cost} onChange={setCost} placeholder={t('maintenance.cost')} />
      <Field label={t('maintenance.notes')} value={notes} onChange={setNotes} placeholder={t('maintenance.notes')} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button tone="quiet" label={t('actions.cancel')} onPress={onClose} />
        <Button label={t('actions.submit')} busy={create.isPending} onPress={handleSubmit} />
      </View>
    </Card>
  );
}
