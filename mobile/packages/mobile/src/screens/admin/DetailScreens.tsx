import React, { useEffect, useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { fmtDateTime } from '../../format';
import { View } from 'react-native';
import { Text } from '../../design/Text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '../../services';
import { AppError, AccidentDetailSchema, AnomalyDetailSchema, DocDetailSchema, FuelDetailSchema, InspectionDetailSchema, TelemetryChainSchema } from '@fleet/shared';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { MediaThumb } from '../../design/MediaThumb';
import { Screen } from '../../design/Screen';
import { parseDecimal } from '../../core/numbers';
import { goto } from '../../navigation/ref';
import { useCan } from '../../state/store';
import { color, font, space } from '../../design/tokens';

const Page = ({ children }: { children: React.ReactNode }) => <Screen offlineTag>{children}</Screen>;
const eat = (iso?: string | null) => (iso ? fmtDateTime(iso) : '');
const code = (e: unknown) => (e instanceof AppError ? e.error_code : 'UNKNOWN');
const KV = ({ k, v }: { k: string; v: unknown }) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}><Text style={{ fontFamily: font.bodyStrong, color: color.mist, flexShrink: 1 }}>{k}</Text><Text selectable style={{ fontFamily: font.body, color: color.asphalt, flexShrink: 1, textAlign: 'right' }}>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</Text></View>;

/** Fetches richer detail when the API has it. The list row passed via route params renders instantly and is the fallback if the call fails. */
function useDetail<O>(key: string, path: string, schema: z.ZodType<O, z.ZodTypeDef, unknown>) { return useQuery<O>({ queryKey: [key, path], queryFn: () => api.get<O>(path, { schema: schema as z.ZodType<O> }), retry: 0, staleTime: 30_000 }); }

// ---- Anomaly (read-only) ---------------------------------------------------
export function AnomalyDetailScreen({ route }: any) {
  const { t } = useTranslation();
  const row = route.params.item as { id: string; domain?: string };
  const q = useDetail('anomaly', url(ENDPOINTS.anomaly, { id: row.id }), AnomalyDetailSchema);
  const a = q.data ?? (row as unknown as z.infer<typeof AnomalyDetailSchema>);
  const open = a.domain === 'FUEL' ? () => goto('Review', { segment: 'fuel' }) : a.domain === 'ACCIDENT' ? () => goto('Accidents') : null;
  const signal = a.signal && typeof a.signal === 'object' ? (a.signal as Record<string, unknown>) : null;
  return (
    <Page>
      <Card>
        <Text style={{ fontFamily: font.heading, fontSize: 20, color: a.severity === 'CRITICAL' || a.severity === 'HIGH' ? color.brake : color.asphalt }}>
          {t(`anomalies.${a.severity}`, { defaultValue: a.severity })} · {t(`anomalies.${a.domain}`, { defaultValue: a.domain })}
        </Text>
        <Title>{a.title ?? a.kind}</Title>
        <Body>{a.body}</Body>
        <Body dim>{eat(a.created_at)}</Body>
      </Card>
      {a.vehicle_plate ? <Card><KV k={t('vehicle.title')} v={a.vehicle_plate} /></Card> : null}
      {a.driver_name ? <Card><KV k={t('drivers.title')} v={a.driver_name} /></Card> : null}
      {a.location_text ? <Card><KV k={t('detail.position')} v={a.location_text} /></Card> : null}
      {signal && Object.keys(signal).length ? <Card><Title>{t('detail.evidence')}</Title>{Object.entries(signal).map(([k, v]) => <KV key={k} k={k.replace(/_/g, ' ')} v={v} />)}</Card> : null}
      {a.recommended_action ? <Card><Body>{a.recommended_action}</Body></Card> : null}
      {open ? <Button tone="quiet" label={t('detail.openRelated')} onPress={open} /> : null}
    </Page>);
}

// ---- Expiring document (read-only) -----------------------------------------
export function DocDetailScreen({ route }: any) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const row = route.params.item as { document_id: string };
  const q = useDetail('doc', url(ENDPOINTS.docDetail, { id: row.document_id }), DocDetailSchema);
  const d = q.data ?? (row as unknown as z.infer<typeof DocDetailSchema>);
  const days = d.days_remaining ?? 0;
  const [note, setNote] = useState(''); const [noteErr, setNoteErr] = useState<string | null>(null); const [noteMsg, setNoteMsg] = useState<string | null>(null);
  async function saveNote() { setNoteErr(null); setNoteMsg(null); try { await api.post(url(ENDPOINTS.setRenewalNote, { id: row.document_id }), { body: { note } }); setNoteMsg(t('docs.noteSaved')); await qc.invalidateQueries({ queryKey: ['docs'] }); } catch (e) { setNoteErr(code(e)); } }
  return (
    <Page>
      <Card>
        <Title>{d.linked_asset ?? d.subject_name ?? '—'}</Title>
        <KV k={t('docs.title')} v={d.document_type ?? '—'} />
        <KV k={t('detail.expires')} v={eat(d.expires_on)} />
        <Text style={{ fontFamily: font.heading, fontSize: 22, color: days <= 7 ? color.brake : color.asphalt }}>{days < 0 ? t('docs.expired') : t('docs.days', { n: days })}</Text>
        {d.document_number ? <KV k={t('detail.document')} v={d.document_number} /> : null}
        {d.issuer ? <KV k={t('detail.issuerName')} v={d.issuer} /> : null}
      </Card>
      {d.metadata?.length ? <Card><Title>{t('detail.evidence')}</Title>{d.metadata.map((m) => <KV key={m.key} k={m.key.replace(/_/g, ' ')} v={m.value ?? '—'} />)}</Card> : null}
      {d.scan_media_id ? <MediaThumb mediaId={d.scan_media_id} /> : null}
      <Card><Body>{t('docs.renewalNote')}</Body>
        <Field label={t('docs.note')} value={note} onChangeText={setNote} multiline />
        {noteErr ? <ErrorState code={noteErr} /> : null}{noteMsg ? <Body>{noteMsg}</Body> : null}
        <Button label={t('docs.saveNote')} onPress={() => void saveNote()} disabled={!note.trim()} /></Card>
    </Page>);
}

/**
 * Accident detail.
 *
 * U-09 resolved. The escalation timers the earlier draft read from `escalation_timers` do not exist on
 * the wire: `AccidentDetailView` exposes a single `seconds_to_escalation` countdown to the next tier
 * and an `escalation_tier` int, so the client derives the countdown from that one number and starts it
 * at mount. There is no `timeline` array either, and there is no `escalation_at` on the summary row,
 * so the acknowledged state comes from `acknowledged_by` on the detail.
 */
function Countdown({ seconds }: { seconds: number }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => { const i = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000); return () => clearInterval(i); }, []);
  const txt = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  return <Text style={{ fontFamily: font.heading, fontSize: 22, color: left === 0 ? color.brake : color.asphalt }}>{left === 0 ? t('detail.overdue') : `${t('detail.due')} ${txt}`}</Text>;
}

export function AccidentDetailScreen({ route }: any) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const row = route.params.item as { accident_id: string };
  const q = useDetail('accident', url(ENDPOINTS.accident, { id: row.accident_id }), AccidentDetailSchema);
  const a = { ...row, ...(q.data ?? {}) } as z.infer<typeof AccidentDetailSchema>;
  const canAck = useCan('accident:acknowledge');
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [chain, setChain] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setErr(null); try { await fn(); } catch (e) { setErr(code(e)); } finally { setBusy(null); } };
  const acked = !!a.acknowledged_by;
  async function addMedia() {
    setUploading(true);
    try {
      const r = await api.post(url(ENDPOINTS.uploadUrl), { body: { content_type: 'image/jpeg', size: 0 }, schema: z.object({ upload_url: z.string().url(), media_object_id: z.string().uuid(), object_key: z.string() }) });
      await api.post(url(ENDPOINTS.accidentMedia, { id: a.accident_id }), { body: { slot: 'OTHER', media_object_id: r.media_object_id } });
      await qc.invalidateQueries({ queryKey: ['accident', a.accident_id] });
    } catch (e) { setErr(code(e)); } finally { setUploading(false); }
  }
  return (
    <Page>
      <Card>
        {a.mayday ? <Text style={{ fontFamily: font.heading, fontSize: 22, color: color.brake }}>{t('admin.mayday')}</Text> : null}
        <Title>{a.reference ?? a.accident_id}</Title>
        <Body dim>{eat(a.occurred_at)}</Body>
        {a.driver_statement ? <Body>{a.driver_statement}</Body> : null}
        {a.location_label ? <Body dim>{a.location_label}</Body> : null}
        <KV k={t('detail.tier')} v={a.escalation_tier ?? '–'} />
        <Body>{acked ? t('detail.acked') : t('detail.notAcked')}</Body>
      </Card>
      {a.seconds_to_escalation != null && !acked ? <Card><Title>{t('detail.timers')}</Title><Countdown seconds={a.seconds_to_escalation} /></Card> : null}
      {a.chain_valid !== null && a.chain_valid !== undefined ? <Card><Body>{a.chain_valid ? t('admin.telemetryOk') : t('admin.telemetryBad')}</Body></Card> : null}
      {err ? <ErrorState code={err} /> : null}
      {canAck && !acked ? <Button label={t('admin.acknowledge')} busy={busy === 'ack'} onPress={() => void run('ack', async () => { await api.post(url(ENDPOINTS.acknowledgeAccident, { id: a.accident_id })); await qc.invalidateQueries({ queryKey: ['accidents'] }); })} /> : null}
      <Button tone="quiet" label={t('admin.telemetry')} busy={busy === 'chain'} onPress={() => void run('chain', async () => { const r = await api.get(url(ENDPOINTS.verifyTelemetry, { id: a.accident_id }), { schema: TelemetryChainSchema }); setChain(r.all_valid); })} />
      <Button tone="quiet" label={t('admin.addMedia')} busy={uploading} onPress={() => void addMedia()} />
      {a.media?.length ? <Card>{a.media.map((m) => <MediaThumb key={m.media_id} mediaId={m.media_id} label={m.slot} />)}</Card> : null}
    </Page>);
}

// ---- Inspection detail: items + photos, then quarantine information -------
export function DvirDetailScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const row = route.params.item as { inspection_id: string; block_shift?: boolean };
  const q = useDetail('dvir', url(ENDPOINTS.inspection, { id: row.inspection_id }), InspectionDetailSchema); const d = q.data;
  const canReview = useCan('inspection:read');
  return (
    <Page>
      {row.block_shift || d?.block_shift ? <Card><Body style={{ color: color.brake }}>{t('detail.quarantine')}</Body></Card> : null}
      {q.error ? <Card><Body dim>{t('detail.noData')}</Body></Card> : null}
      {d?.template_label ? <Title>{d.template_label}</Title> : null}
      {d?.vehicle_plate ? <Body dim>{d.vehicle_plate}</Body> : null}
      {d?.submitted_at ? <Body dim>{fmtDateTime(d.submitted_at)}</Body> : null}
      {d?.signature_name ? <Body dim>{d.signature_name}</Body> : null}
      {d?.items.map((i) => (
        <Card key={i.template_item_id}>
          <Body>{i.label}</Body>
          <Text style={{ fontFamily: font.heading, color: i.result === 'FAIL' ? color.brake : color.asphalt }}>
            {i.result === 'FAIL' ? t('detail.failed') : i.result === 'PASS' ? t('detail.passed') : t('detail.na')}{i.blocker ? ` · ${t('detail.tierShort', { n: 1 })}` : ''}
          </Text>
          {i.notes ? <Body dim>{i.notes}</Body> : null}
          {i.photo_media_object_id ? <MediaThumb mediaId={i.photo_media_object_id} /> : null}
        </Card>))}
      {!canReview ? <Body dim>{t('settings.readOnly')}</Body> : null}
      <Button tone="quiet" label={t('state.dismiss')} onPress={() => navigation.goBack()} />
    </Page>);
}

/**
 * Fuel purchase detail. `FuelReconciliationRow` is a flat projection: numeric columns arrive from PG
 * as strings and are parsed leniently, money is NOT nested (`currency` + `total_cost`), and the
 * anomaly information is `open_anomalies` / `worst_open_severity`, not an `anomaly_flags` array.
 */
export function FuelDetailScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const row = route.params.item as { fuel_purchase_id: string };
  const q = useDetail('fuel', url(ENDPOINTS.fuelInbox), FuelDetailSchema);
  const d = (q.data as z.infer<typeof FuelDetailSchema> | undefined);
  const canVerify = useCan('fuel:verify'); const canAdjust = useCan('fuel:adjust'); const canClear = useCan('fuel:clear_payment');
  const [adjust, setAdjust] = useState(''); const [reject, setReject] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const post = async (k: string, body: object) => { setBusy(k); setErr(null); try { await api.post(url(ENDPOINTS.verifyFuel, { id: row.fuel_purchase_id }), { body }); await qc.invalidateQueries({ queryKey: ['fuel-inbox'] }); navigation.goBack(); } catch (e) { setErr(code(e)); } finally { setBusy(null); } };
  const delta = d?.gauge_before_percent != null && d?.gauge_after_percent != null ? d.gauge_after_percent - d.gauge_before_percent : null;
  return (
    <Page>
      <Card>
        <Title>{row.fuel_purchase_id.slice(0, 8)}</Title>
        {d ? <><Body>{d.litres ?? '—'} L · {d.currency} {d.total_cost ?? '—'}</Body><Body dim>{fmtDateTime(d.purchased_at)}</Body>
          {d.vehicle_plate ? <KV k={t('vehicle.title')} v={d.vehicle_plate} /> : null}
          {d.odometer_km != null ? <KV k={t('shift.odometer')} v={d.odometer_km} /> : null}
          {d.fuel_card_last_four ? <KV k={t('forms.cardLast4')} v={`•••• ${d.fuel_card_last_four}`} /> : null}
          {d.ocr_status ? <KV k={t('forms.receipt')} v={d.ocr_status} /> : null}</> : null}
      </Card>
      {delta !== null && d ? <Card><KV k={t('detail.gaugeBefore')} v={`${d.gauge_before_percent}%`} /><KV k={t('detail.gaugeAfter')} v={`${d.gauge_after_percent}%`} /><KV k={t('detail.gaugeDelta')} v={`${delta > 0 ? '+' : ''}${delta}%`} /></Card> : null}
      {d?.worst_open_severity ? <Card><Body style={{ color: color.brake }}>{d.worst_open_severity}</Body><Body dim>{d.open_anomalies ?? ''}</Body></Card> : null}
      {d?.receipt_media_object_id ? <MediaThumb mediaId={d.receipt_media_object_id} label={t('forms.receipt')} /> : null}
      {canAdjust ? <Field label={t('detail.adjustLitres')} value={adjust} onChange={setAdjust} keyboardType="decimal-pad" /> : null}
      {reject ? <Field label={t('detail.rejectReason')} value={reason} onChange={setReason} multiline /> : null}
      {err ? <ErrorState code={err} /> : null}
      {!canVerify && !canClear ? <Body dim>{t('settings.readOnly')}</Body> : null}
      {canVerify ? <Button label={t('admin.verify')} busy={busy === 'v'} onPress={() => void post('v', { action: 'VERIFY', ...(adjust && parseDecimal(adjust) ? { adjusted_litres: parseDecimal(adjust) } : {}) })} /> : null}
      {canVerify ? <Button tone="danger" label={t('admin.reject')} disabled={reject && !reason.trim()} busy={busy === 'r'} onPress={() => (reject ? void post('r', { action: 'REJECT', rejection_reason: reason.trim() }) : setReject(true))} /> : null}
      {canClear ? <Button tone="quiet" label={t('admin.clearPayment')} busy={busy === 'c'} onPress={() => void post('c', { action: 'CLEAR_PAYMENT' })} /> : null}
    </Page>);
}