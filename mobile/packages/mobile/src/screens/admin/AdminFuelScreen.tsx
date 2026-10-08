import React from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../services';
import { AppError, FuelPendingRowSchema, VerifyPurchaseSchema } from '@fleet/shared';
import { useCursorList } from '../../core/lists';
import { fmtDateTime } from '../../format';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { PagedList } from '../../design/PagedList';
import { Text } from '../../design/Text';
import { color, font, space } from '../../design/tokens';
import { useCan } from '../../state/store';
import { goto } from '../../navigation/ref';

type FuelPending = z.infer<typeof FuelPendingRowSchema>;

export function AdminFuelScreen({ navigation }: any) {
  const { t } = useTranslation(); const qc = useQueryClient(); const canVerify = useCan('fuel:verify'); const canAdjust = useCan('fuel:adjust'); const canClear = useCan('fuel:clear_payment');
  const l = useCursorList(['admin-fuel'], url(ENDPOINTS.adminFuelPending), FuelPendingRowSchema, undefined, { staleTime: 30_000 });
  const post = async (id: string, body: object) => { try { await api.post(url(ENDPOINTS.verifyFuel, { id }), { body, schema: VerifyPurchaseSchema }); await qc.invalidateQueries({ queryKey: ['admin-fuel'] }); } catch (e) { throw e instanceof AppError ? e : new Error('UNKNOWN'); } };
  return (
    <PagedList list={l} keyOf={(r) => r.fuel_purchase_id} empty={t('admin.emptyFuel')}
      render={(r) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('FuelDetail', { item: { fuel_purchase_id: r.fuel_purchase_id, litres: r.liters_pumped, total_cost: { amount: String(r.amount_spent ?? '–'), currency: '' }, anomaly_flags: [] } })}>
          <Card><Body>{r.driver_name ?? r.vehicle_plate ?? r.fuel_purchase_id.slice(0, 8)}</Body>
            <Body dim>{t('shift.odometer')}: {r.odometer_km ?? '–'} · {t('detail.gaugeBefore')}: – · {t('detail.gaugeAfter')}: –</Body>
            {r.confidence_score != null ? <Body dim>{t('forms.receipt')}: {Math.round(r.confidence_score * 100)}%</Body> : null}
            {r.badge ? <Text style={{ fontFamily: font.bodyStrong, color: color.brake }}>{r.badge}</Text> : null}</Card>
        </Pressable>
      )} />
  );
}
