import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppError, ForceCloseShiftSchema, ShiftRowSchema, ShiftWorkPlanSchema, VerifyShiftResponseSchema } from '@fleet/shared';
import type { z } from 'zod';
import { api } from '../../services';
import { fmtDateTime } from '../../format';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { Screen } from '../../design/Screen';
import { useCan } from '../../state/store';

type Shift = z.infer<typeof ShiftRowSchema>;
const duration = (a: string, b?: string | null) => { if (!b) return null; const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)); return { h: Math.floor(m / 60), m: m % 60 }; };

export function ShiftDetailScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const qc = useQueryClient(); const s = route.params.item as Shift; const d = s.clock_in_at && s.clock_out_at ? duration(s.clock_in_at, s.clock_out_at) : null;
  const canVerify = useCan('shift:verify'); const canForce = useCan('shift:force_close');
  const [flag, setFlag] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [force, setForce] = useState(false); const [forceReason, setForceReason] = useState(''); const [forceErr, setForceErr] = useState<string | null>(null);
  const plan = useQuery({ queryKey: ['work-plan', s.shift_id], enabled: !!s.shift_id, queryFn: () => api.get(url(ENDPOINTS.shiftWorkPlan, { id: s.shift_id }), { schema: ShiftWorkPlanSchema }), staleTime: 60_000 });
  async function post(body: object) {
    setBusy(true); setErr(null);
    try { await api.post(url(ENDPOINTS.verifyShift, { id: s.shift_id }), { body, schema: VerifyShiftResponseSchema }); await qc.invalidateQueries({ queryKey: ['shift-inbox'] }); navigation.goBack(); }
    catch (e) { setErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } finally { setBusy(false); }
  }
  async function doForce() { setForceErr(null); try { const body = ForceCloseShiftSchema.parse({ reason: forceReason || undefined }); await api.post(url(ENDPOINTS.forceCloseShift, { id: s.shift_id }), { body }); await qc.invalidateQueries({ queryKey: ['shift-inbox'] }); navigation.goBack(); } catch (e) { setForceErr(e instanceof AppError ? e.error_code : 'UNKNOWN'); } }
  return (
    <Screen>
      <Card><Title>{t(`shifts.${s.verification_status}`)}</Title><Body dim>{t(`shifts.${s.state}`)}</Body>
        <Body>{t('shifts.clockIn')}: {fmtDateTime(s.clock_in_at)}</Body>{s.clock_out_at ? <Body>{t('shifts.clockOut')}: {fmtDateTime(s.clock_out_at)}</Body> : null}
        {s.distance_km != null ? <Body>{t('shifts.distance')}: {t('shifts.km', { n: s.distance_km })}</Body> : null}{d ? <Body>{t('shifts.duration')}: {t('shifts.hours', d)}</Body> : null}</Card>
      {plan.data ? <Card><Title>{t('shifts.workPlan')}</Title>{plan.data.planned_notes ? <Body>{plan.data.planned_notes}</Body> : <Body dim>{t('shifts.noPlan')}</Body>}{plan.data.photos?.length ? plan.data.photos.map((p) => <Body dim key={p.media_object_id}>Photo {p.sequence}</Body>) : null}{plan.data.debrief_notes ? <Body dim>{plan.data.debrief_notes}</Body> : null}</Card> : null}
      {flag ? <Field label={t('shifts.flagReason')} value={reason} onChange={setReason} multiline /> : null}
      {err ? <ErrorState code={err} /> : null}
      {!canVerify ? <Body dim>{t('settings.readOnly')}</Body> : null}
      {canVerify && s.verification_status !== 'VERIFIED' && s.verification_status != null ? <Button label={t('admin.verify')} busy={busy} onPress={() => void post({ action: 'VERIFY' })} /> : null}
      {canVerify ? <Button tone="danger" label={t('admin.flag')} disabled={flag && !reason.trim()} onPress={() => (flag ? void post({ action: 'FLAG', flag_reason: reason.trim() }) : setFlag(true))} /> : null}
      {canForce && s.state !== 'CLOSED' ? <><Button tone="quiet" label={force ? t('shifts.forceCloseReason') : t('shifts.forceClose')} onPress={() => setForce((v) => !v)} />{force ? <Field label={t('shifts.forceCloseReason')} value={forceReason} onChange={setForceReason} multiline /> : null}{forceErr ? <ErrorState code={forceErr} /> : null}{force ? <Button tone="danger" label={t('shifts.forceClose')} onPress={() => void doForce()} /> : null}</> : null}
    </Screen>
  );
}
