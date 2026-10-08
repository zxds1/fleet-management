import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Body, Button, Card } from './components';
import { announce } from './states';
import { goto } from '../navigation/ref';

export interface DoneInfo { queued: boolean; anomalies?: string[] }
/**
 * Wraps a form so that after a successful submit it is emptied (remounted) and a confirmation shows at the top.
 * Without this, tab forms kept their old values: easy to double-submit the same refuel or inspection by mistake.
 */
export function FormShell({ children }: { children: (p: { onDone: (d: DoneInfo) => void; banner: React.ReactNode }) => React.ReactNode }) {
  const { t } = useTranslation(); const [key, setKey] = useState(0); const [done, setDone] = useState<DoneInfo | null>(null);
  const onDone = (d: DoneInfo) => { setDone(d); setKey((k) => k + 1); announce(d.queued ? t('forms.queued') : t('forms.sent')); };
  const banner = done ? (
    <Card>
      <Body>{done.queued ? t('forms.queued') : t('forms.sent')}</Body>
      {done.anomalies?.length ? <Body dim>{t('forms.flagged', { items: done.anomalies.map((a) => t(`errors.${a}`, { defaultValue: a })).join(', ') })}</Body> : null}
      {done.anomalies?.length ? <Button tone="quiet" label={t('actions.VIEW_FLAGS')} onPress={() => goto('Inbox', { initial: 'flags' })} /> : null}
      <Button tone="quiet" label={t('state.dismiss')} onPress={() => setDone(null)} />
    </Card>) : null;
  return <React.Fragment key={key}>{children({ onDone, banner })}</React.Fragment>;
}
