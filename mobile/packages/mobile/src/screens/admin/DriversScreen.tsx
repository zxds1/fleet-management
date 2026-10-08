import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { fmtDateTime } from '../../format';
import { Pressable, ScrollView, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../services';
import { AppError, CreateDriverSchema, DriverDetailSchema, DriverSummarySchema } from '@fleet/shared';
import { useCursorList } from '../../core/lists';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { PagedList } from '../../design/PagedList';
import { color, space } from '../../design/tokens';

type Driver = z.infer<typeof DriverSummarySchema>;
const eat = (iso: string | null) => (iso ? fmtDateTime(iso) : '–');

export function DriversScreen({ navigation }: any) {
  const { t } = useTranslation(); const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED' | undefined>(undefined);
  const l = useCursorList(['drivers'], url(ENDPOINTS.drivers), DriverSummarySchema, { status }, { staleTime: 300_000, gcTime: 86_400_000 });
  const [createOpen, setCreateOpen] = useState(false); const [form, setForm] = useState({ email: '', full_name: '', password: '' }); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  async function create() { setErr(null); setMsg(null); try { const body = CreateDriverSchema.parse(form); await api.post(url(ENDPOINTS.createDriver), { body }); setForm({ email: '', full_name: '', password: '' }); setCreateOpen(false); setMsg(t('drivers.created')); } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  return (
    <View style={{ flex: 1, backgroundColor: color.dust }}>
      <PagedList list={l} keyOf={(d) => d.user_id} empty={t('drivers.empty')}
        header={<View style={{ gap: space.sm }}><View style={{ flexDirection: 'row', gap: space.sm }}>{([undefined, 'ACTIVE', 'SUSPENDED'] as const).map((s) => <View key={s ?? 'all'} style={{ flex: 1 }}><Button tone={status === s ? 'primary' : 'quiet'} label={s ? t(`drivers.${s.toLowerCase()}`) : t('anomalies.all')} onPress={() => setStatus(s)} /></View>)}</View><View style={{ padding: space.md, paddingBottom: 0 }}><Button label={t('drivers.create')} onPress={() => setCreateOpen(true)} /></View></View>}
        render={(d) => (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('DriverDetail', { driver: d })}>
            <Card><Body>{d.full_name ?? d.email}</Body><Body dim>{d.status === 'ACTIVE' ? t('drivers.active') : t('drivers.suspended')} · {d.mfa_enrolled ? t('drivers.mfa') : t('drivers.noMfa')} · {t('drivers.lastLogin')} {eat(d.last_login_at)}</Body></Card>
          </Pressable>)} />
      {createOpen ? <ScrollView style={{ position: 'absolute', inset: 0, backgroundColor: color.dust }} contentContainerStyle={{ padding: space.md, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Title>{t('drivers.create')}</Title>
        <Field label={t('drivers.email')} value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} autoCapitalize="none" />
        <Field label={t('profileExtra.name')} value={form.full_name} onChangeText={(v) => setForm((f) => ({ ...f, full_name: v }))} />
        <Field label={t('auth.password')} value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} secureTextEntry />
        {err ? <ErrorState code={err} /> : null}{msg ? <Card><Body>{msg}</Body></Card> : null}
        <Button label={t('drivers.create')} onPress={() => void create()} disabled={!form.email.trim() || !form.full_name.trim() || form.password.length < 8} />
        <Button tone="quiet" label={t('state.dismiss')} onPress={() => { setCreateOpen(false); setErr(null); setMsg(null); }} />
      </ScrollView> : null}
    </View>
  );
}

type Pending = string | null;
export function DriverDetailScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const qc = useQueryClient(); const d = route.params.driver as Driver;
  const [pending, setPending] = useState<Pending>(null); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false); const [approveErr, setApproveErr] = useState<string | null>(null);
  const act = (key: string, run: () => Promise<unknown>, after: 'stay' | 'back' = 'stay') => async () => {
    if (pending !== key) { setPending(key); return; }
    setPending(null); setErr(null); setMsg(null);
    try { await run(); await qc.invalidateQueries({ queryKey: ['drivers'] }); if (after === 'back') navigation.goBack(); else setMsg(t('forms.sent')); } catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); }
  };
  const label = (key: string, text: string) => (pending === key ? t('drivers.confirm') : text);
  async function approve() { setApproveErr(null); try { await api.post(url(ENDPOINTS.approveDriver, { id: d.user_id }), { body: { user_id: d.user_id } }); setApproveOpen(false); setMsg(t('drivers.approved')); } catch (e) { setApproveErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  return (
    <ScrollView style={{ backgroundColor: color.dust }} contentContainerStyle={{ padding: space.md, gap: space.md }}>
      <Card><Title>{d.full_name ?? d.email}</Title><Body dim>{d.email}</Body>
        <Body>{d.status === 'ACTIVE' ? t('drivers.active') : t('drivers.suspended')} · {d.mfa_enrolled ? t('drivers.mfa') : t('drivers.noMfa')}</Body><Body dim>{t('drivers.lastLogin')}: {eat(d.last_login_at)}</Body></Card>
      <Card><Body>{t('drivers.devices')}</Body>
        {d.devices.map((dev) => (<View key={dev.device_id} style={{ gap: space.xs }}><Body dim>{dev.platform} · {dev.device_id.slice(0, 8)} · {eat(dev.last_seen_at)}</Body><Button tone="quiet" label={label(`dev:${dev.device_id}`, t('drivers.revokeDevice'))} onPress={act(`dev:${dev.device_id}`, () => api.post(url(ENDPOINTS.revokeDevice, { id: dev.device_id })))} /></View>))}
      </Card>
      {err ? <ErrorState code={err} /> : null}{msg ? <Card><Body>{msg}</Body></Card> : null}
      <Body dim>{d.mfa_enrolled ? t('drivers.mfa') : t('drivers.noMfa')}</Body>
      <Button tone="quiet" label={label(`rs:${d.user_id}`, t('drivers.revokeSessions'))} onPress={act(`rs:${d.user_id}`, () => api.post(url(ENDPOINTS.revokeSessions), { body: { user_id: d.user_id } }))} />
      <Button tone="danger" label={label(`su:${d.user_id}`, d.status === 'ACTIVE' ? t('drivers.suspend') : t('drivers.reinstate'))} onPress={act(`su:${d.user_id}`, () => api.post(url(d.status === 'ACTIVE' ? ENDPOINTS.suspendUser : ENDPOINTS.reinstateUser, { id: d.user_id })), 'back')} />
      {approveOpen ? <Card><Title>{t('drivers.approve')}</Title><Body>{d.full_name ?? d.email}</Body>{approveErr ? <ErrorState code={approveErr} /> : null}<Button label={t('drivers.confirm')} onPress={() => void approve()} /><Button tone="quiet" label={t('state.dismiss')} onPress={() => setApproveOpen(false)} /></Card> : null}
    </ScrollView>
  );
}
