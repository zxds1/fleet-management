import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FuelRowSchema, InspectionRowSchema, ShiftRowSchema, VerificationStatus, operationalDateString } from '@fleet/shared';
import { REVIEW_QUEUE_DAYS } from '../../core/policy';
import type { z } from 'zod';
import { useCursorList } from '../../core/lists';
import { fmtDateTime } from '../../format';
import { Body, Button, Card, ErrorState } from '../../design/components';
import { PagedList } from '../../design/PagedList';
import { Segmented } from '../../design/Segmented';
import { Text } from '../../design/Text';
import { chipHeight, color, font, radius, space } from '../../design/tokens';

type Seg = 'shifts' | 'inspections' | 'fuel';
const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: chipHeight, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.control, borderWidth: 2, borderColor: color.asphalt, backgroundColor: on ? color.asphalt : color.paper }}>
    <Text style={{ fontFamily: font.bodyStrong, color: on ? color.paper : color.asphalt }}>{label}</Text>
  </Pressable>);

/** Everything an admin must verify, in one screen with three segments: shifts, inspections, fuel. Was three separate screens and dashboard buttons. */
export function ReviewQueueScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const [seg, setSeg] = useState<Seg>(route?.params?.segment ?? 'shifts');
  return (
    <View style={{ flex: 1, backgroundColor: color.dust }}>
      <View style={{ padding: space.md, paddingBottom: 0 }}><Segmented<Seg> value={seg} onChange={setSeg} options={[{ key: 'shifts', label: t('review.shifts') }, { key: 'inspections', label: t('review.inspections') }, { key: 'fuel', label: t('review.fuel') }]} /></View>
      {seg === 'shifts' ? <Shifts navigation={navigation} /> : seg === 'inspections' ? <Inspections navigation={navigation} /> : <Fuel navigation={navigation} />}
    </View>
  );
}

const STATUSES = VerificationStatus.options; const STATES = ['OPEN', 'PENDING_CLOSEOUT', 'CLOSED'] as const;
function Shifts({ navigation }: { navigation: any }) {
  const { t } = useTranslation();
  // B-09 (decided): the queue opens on TODAY's Kenyan date, status PENDING. `GET /shifts/verification-inbox`
// filters on an EXACT `operational_date` and defaults to ALL dates when the param is omitted, so "open on
// today" is a client default. `REVIEW_QUEUE_DAYS` is the hook: raise it and the chip label follows.
  // The window the "today" chip covers. 1 = today only.
  const today = operationalDateString();
  const [date, setDate] = useState<string | null>(today); const [status, setStatus] = useState<(typeof STATUSES)[number] | null>('PENDING'); const [state, setState] = useState<(typeof STATES)[number] | null>(null);
  // `REVIEW_QUEUE_DAYS > 1` widens the default window: the endpoint takes one exact operational_date, so a
  // wider window is a `from` instead. Today it is 1, i.e. the exact date, which is what the backend supports.
  const from = REVIEW_QUEUE_DAYS > 1 ? operationalDateString(new Date(Date.now() - (REVIEW_QUEUE_DAYS - 1) * 86_400_000)) : undefined;
  const l = useCursorList(['shift-inbox'], url(ENDPOINTS.shiftInbox), ShiftRowSchema, { from: from ?? (date ?? undefined), verification_status: status ?? undefined, state: state ?? undefined }, { staleTime: 30_000 });
  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      <Chip label={t('shifts.today')} on={date === today} onPress={() => setDate(today)} /><Chip label={t('shifts.anyDate')} on={date === null} onPress={() => setDate(null)} />
      {STATUSES.map((s) => <Chip key={s} label={t(`shifts.${s}`)} on={status === s} onPress={() => setStatus(status === s ? null : s)} />)}
      {STATES.map((s) => <Chip key={s} label={t(`shifts.${s}`)} on={state === s} onPress={() => setState(state === s ? null : s)} />)}
    </ScrollView>);
  return <PagedList list={l} keyOf={(s) => s.shift_id} empty={t('shifts.empty')} header={filters} render={(s: z.infer<typeof ShiftRowSchema>) => (
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ShiftDetail', { item: s })}>
      <Card><Body>{fmtDateTime(s.clock_in_at)}</Body><Body dim>{t(`shifts.${s.verification_status}`)} · {t(`shifts.${s.state}`)}{s.distance_km != null ? ` · ${t('shifts.km', { n: s.distance_km })}` : ''}</Body></Card>
    </Pressable>)} />;
}

function Inspections({ navigation }: { navigation: any }) {
  const { t } = useTranslation(); const l = useCursorList(['dvir-queue'], url(ENDPOINTS.inspections), InspectionRowSchema, { state: 'SUBMITTED' }, { staleTime: 30_000 });
  return <PagedList list={l} keyOf={(i) => i.inspection_id} empty={t('admin.emptyDvir')} render={(i) => (
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('DvirDetail', { item: i })}>
      <Card><Body>{i.vehicle_plate ?? i.vehicle_id ?? i.inspection_id}</Body>{i.submitted_at ? <Body dim>{fmtDateTime(i.submitted_at)}</Body> : null}{i.quarantined || i.block_shift ? <Body style={{ color: color.brake }}>{t('detail.quarantine')}</Body> : null}</Card>
    </Pressable>)} />;
}

function Fuel({ navigation }: { navigation: any }) {
  const { t } = useTranslation(); const l = useCursorList(['fuel-inbox'], url(ENDPOINTS.fuelInbox), FuelRowSchema, { verified: false }, { staleTime: 30_000 });
  return <PagedList list={l} keyOf={(p) => p.fuel_purchase_id} empty={t('admin.emptyFuel')} header={<Button tone="quiet" label={t('importer.title')} onPress={() => navigation.navigate('ImportStatement')} />} render={(p) => (
    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('FuelDetail', { item: p })}>
      <Card><Body>{p.litres ?? '—'} L · {p.currency} {p.total_cost ?? '—'}</Body><Body dim>{fmtDateTime(p.purchased_at)}</Body>{p.worst_open_severity ? <Text style={{ fontFamily: font.bodyStrong, color: color.brake }}>{p.worst_open_severity}</Text> : null}</Card>
    </Pressable>)} />;
}
