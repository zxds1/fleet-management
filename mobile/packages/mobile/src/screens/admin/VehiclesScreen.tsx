import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Modal, Pressable, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../services';
import { VehicleCreateSchema, VehicleRecordSchema, VehicleUpdateSchema, type VehicleCreateInput, type VehicleRecord, type VehicleUpdateInput } from '@fleet/shared';
import { Body, Button, Card, Field, StatusBadge, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { color, space } from '../../design/tokens';
import { useCan } from '../../state/store';
import { goto } from '../../navigation/ref';

type Vehicle = z.infer<typeof VehicleRecordSchema>;

function VehicleForm({ visible, onClose, vehicle }: { visible: boolean; onClose: () => void; vehicle?: Vehicle }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!vehicle;
  const [plate, setPlate] = useState(vehicle?.license_plate ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [vClass, setVClass] = useState(vehicle?.vehicle_class ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (isEdit) {
        const body: VehicleUpdateInput = { notes: vehicle!.notes, non_operational_reason: vehicle!.non_operational_reason };
        await api.patch(url(ENDPOINTS.updateVehicle, { id: vehicle!.id }), { body });
      } else {
        const body: VehicleCreateInput = { license_plate: plate, make, model, vehicle_class: vClass };
        await api.post(url(ENDPOINTS.createVehicle), { body });
      }
      void qc.invalidateQueries({ queryKey: ['vehicles'] });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: color.paper, padding: space.md, gap: space.sm, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <Title>{isEdit ? t('vehicle.edit') : t('vehicle.create')}</Title>
          {isEdit ? null : (
            <>
              <Field label={t('vehicle.plate')} value={plate} onChange={setPlate} placeholder={t('vehicle.plate')} />
              <Field label={t('vehicle.make')} value={make} onChange={setMake} placeholder={t('vehicle.make')} />
              <Field label={t('vehicle.model')} value={model} onChange={setModel} placeholder={t('vehicle.model')} />
              <Field label={t('vehicle.class')} value={vClass} onChange={setVClass} placeholder={t('vehicle.class')} />
            </>
          )}
          {isEdit ? (
            <Field label={t('vehicle.nonOperationalReason')} value={vehicle?.non_operational_reason ?? ''} onChange={() => {}} placeholder={t('vehicle.nonOperationalReason')} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button tone="quiet" label={t('actions.cancel')} onPress={onClose} />
            <Button label={t('actions.save')} busy={submitting} onPress={handleSave} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function VehiclesScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get(url(ENDPOINTS.vehicles), { schema: z.array(VehicleRecordSchema) }), staleTime: 30_000 });
  const list = q.data ?? [];
  const canCreate = useCan('asset:create');
  const canUpdate = useCan('asset:update');
  const canAssign = useCan('asset:update');
  const canReport = useCan('vehicle:report');

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [creating, setCreating] = useState(false);

  const toggleOperational = async (v: Vehicle) => {
    const body: VehicleUpdateInput = { is_operational: !v.is_operational };
    await api.patch(url(ENDPOINTS.updateVehicle, { id: v.id }), { body });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  };

  return (
    <Screen offlineTag>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('vehicle.title')}</Title>
        {canCreate ? <Button tone="quiet" label={t('vehicle.create')} onPress={() => setCreating(true)} /> : null}
      </View>
      {q.isLoading ? <Body dim>{t('state.loading')}</Body> : null}
      {q.error ? <Body dim>{q.error.message}</Body> : null}
      {list.map((v) => (
        <Card key={v.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Body style={{ fontWeight: 'bold' }}>{v.license_plate}</Body>
              <Body dim>{[v.make, v.model, v.year ? `${v.year}` : null].filter(Boolean).join(' ') || '–'}</Body>
              {v.current_odometer_km != null ? <Body dim>{t('shift.odometer')}: {v.current_odometer_km}</Body> : null}
              {v.non_operational_reason ? <Body style={{ color: color.brake }}>{v.non_operational_reason}</Body> : null}
            </View>
            <View style={{ backgroundColor: v.is_operational ? color.verge : color.brake, borderRadius: 8, paddingHorizontal: space.sm, paddingVertical: space.xs }}>
              <Body style={{ color: color.paper, fontSize: 12 }}>{v.is_operational ? t('status.OPERATIONAL') : t('status.QUARANTINED')}</Body>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            {canUpdate ? <Button tone="quiet" label={t('vehicle.edit')} onPress={() => setEditing(v)} /> : null}
            {canUpdate ? <Button tone="quiet" label={t('vehicle.toggleOperational')} onPress={() => toggleOperational(v)} /> : null}
            {canAssign ? <Button tone="quiet" label={t('hardware.pair')} onPress={() => goto('TrackerPair')} /> : null}
            {canReport ? <Button tone="quiet" label={t('vehicle.reportIssue')} onPress={() => goto('VehicleIssues', { vehicleId: v.id })} /> : null}
          </View>
        </Card>
      ))}
      <VehicleForm visible={creating} onClose={() => setCreating(false)} />
      <VehicleForm visible={!!editing} onClose={() => setEditing(null)} vehicle={editing ?? undefined} />
    </Screen>
  );
}
