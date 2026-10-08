import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { api } from '../../services';
import { AppError } from '@fleet/shared';
import { fieldErrorMap } from '../../core/errors';
import { uploadMedia } from '../../core/media';
import { StatementResponseSchema } from '@fleet/shared';
import { Body, Button, Card, ErrorState, Field, Title } from '../../design/components';
import { BackgroundImage } from '../../design/BackgroundImage';
import { bgImage } from '../../design/branding';
import { color, space } from '../../design/tokens';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The CSV is uploaded through the normal media presign path with owner_kind and retention_class
// STATEMENT_IMPORT and content_type text/csv. `MediaUploadSchema.content_type` is any non-empty string up
// to 200 characters, so text/csv is accepted (see docs/ASSUMPTIONS.md E-15). Only the media id goes in
// the statement body.
export function ImportStatementScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [map, setMap] = useState({ date_column: 'Date', amount_column: 'Amount', card_last_four_column: 'Card', litres_column: 'Litres', station_column: 'Station' });
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ code: string; fields: Record<string, string> } | null>(null); const [done, setDone] = useState(false);
  const bad = (v: string) => (v && !DATE.test(v) ? t('importer.badDate') : undefined);
  async function pick() { const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'], copyToCacheDirectory: true }); if (!r.canceled) setFile(r.assets[0] ?? null); }
  async function submit() {
    if (!file) return; setBusy(true); setErr(null); setDone(false);
    try {
      const blob = await (await fetch(file.uri)).blob();
      const media = await uploadMedia(api, blob, { owner_kind: 'FUEL_PURCHASE', retention_class: 'STATEMENT_IMPORT', content_type: 'text/csv' });
      await api.post(url(ENDPOINTS.importStatement), { body: { provider: provider.trim(), period_start: start, period_end: end, media_object_id: media, column_mapping: map }, schema: StatementResponseSchema });
      setDone(true); setTimeout(() => navigation.goBack(), 800);
    } catch (e) { setErr({ code: e instanceof AppError ? e.error_code : 'UNKNOWN', fields: fieldErrorMap(e, t) }); } finally { setBusy(false); }
  }
  const m = (k: keyof typeof map) => (v: string) => setMap((s) => ({ ...s, [k]: v }));
  return (
    <BackgroundImage source={bgImage.admin}>
      <ScrollView style={{ backgroundColor: color.dust }} contentContainerStyle={{ padding: space.md, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Title>{t('importer.title')}</Title>
        <Field label={t('importer.provider')} value={provider} onChangeText={setProvider} error={err?.fields.provider} />
        <Field label={t('importer.periodStart')} value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" error={bad(start) ?? err?.fields.period_start} />
        <Field label={t('importer.periodEnd')} value={end} onChangeText={setEnd} keyboardType="numbers-and-punctuation" error={bad(end) ?? err?.fields.period_end} />
        <Button tone="quiet" label={t('importer.pick')} onPress={() => void pick()} />
        {file ? <Body dim>{t('importer.picked', { name: file.name })}</Body> : null}
        <Card><Body>{t('importer.mapping')}</Body>
          <Field label={t('importer.date')} value={map.date_column} onChangeText={m('date_column')} autoCapitalize="none" />
          <Field label={t('importer.amount')} value={map.amount_column} onChangeText={m('amount_column')} autoCapitalize="none" />
          <Field label={t('importer.card')} value={map.card_last_four_column} onChangeText={m('card_last_four_column')} autoCapitalize="none" />
          <Field label={t('importer.litres')} value={map.litres_column} onChangeText={m('litres_column')} autoCapitalize="none" />
          <Field label={t('importer.station')} value={map.station_column} onChangeText={m('station_column')} autoCapitalize="none" /></Card>
        {err ? <ErrorState code={err.code} /> : null}{done ? <Card><Body>{t('importer.done')}</Body></Card> : null}
        <Button label={t('importer.submit')} onPress={submit} busy={busy} disabled={!file || !provider.trim() || !DATE.test(start) || !DATE.test(end)} />
      </ScrollView>
    </BackgroundImage>
  );
}
