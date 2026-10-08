import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getQueue, refreshOutboxCount } from '../../services';
import { Body, Button, ErrorState, Field } from '../../design/components';
import { Screen } from '../../design/Screen';
import { useDiscardGuard } from '../../design/hooks';
import { parseDecimal } from '../../core/numbers';

// ---- Outbox "Edit": change a failed write's values, resend under a NEW idempotency key ------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
type Leaf = { path: string[]; value: string | number };
function leaves(v: unknown, path: string[] = []): Leaf[] {
  if (typeof v === 'number' || (typeof v === 'string' && !UUID.test(v))) return [{ path, value: v }];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...path, String(i)]));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, k]));
  return [];
}
function setAt(root: unknown, path: string[], value: unknown): unknown {
  if (!path.length) return value;
  const [h, ...rest] = path as [string, ...string[]]; const clone: any = Array.isArray(root) ? [...root] : { ...(root as object) };
  clone[h] = setAt(clone[h], rest, value); return clone;
}
export function EditQueuedScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const [item, setItem] = useState<{ id: number; body: unknown; error_code: string | null } | null>(null); const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { void getQueue().then((q) => q.getItem(route.params.id)).then((r) => { if (r) { setItem(r); setVals(Object.fromEntries(leaves(r.body).map((l) => [l.path.join('.'), String(l.value)]))); } }); }, [route.params.id]);
  useDiscardGuard(navigation, dirty);
  if (!item) return <Screen><Body>{t('app.loading')}</Body></Screen>;
  async function save() {
    if (!item) return; let body = item.body;
    for (const l of leaves(item.body)) { const raw = vals[l.path.join('.')] ?? String(l.value); body = setAt(body, l.path, typeof l.value === 'number' ? parseDecimal(raw) ?? l.value : raw); }
    const q = await getQueue(); await q.edit(item.id, body); setDirty(false); await q.drain(); await refreshOutboxCount(); await qc.invalidateQueries({ queryKey: ['outbox'] }); navigation.goBack();
  }
  return (
    <Screen>
      {item.error_code ? <ErrorState code={item.error_code} /> : null}
      {leaves(item.body).map((l) => <Field key={l.path.join('.')} label={l.path.join(' › ').replace(/_/g, ' ')} value={vals[l.path.join('.')] ?? ''} onChangeText={(v) => { setDirty(true); setVals((s) => ({ ...s, [l.path.join('.')]: v })); }} keyboardType={typeof l.value === 'number' ? 'decimal-pad' : 'default'} />)}
      <Button label={t('forms.submit')} onPress={save} />
    </Screen>);
}
