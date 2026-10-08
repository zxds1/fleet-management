import React, { useState } from 'react';
import { ENDPOINTS, url } from '../../api/endpoints';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ANOMALY_DOMAINS, AnomalySchema, DocumentSummarySchema, NotificationSchema, isUnread } from '@fleet/shared';
import type { z } from 'zod';
import { api } from '../../services';
import { useCursorList } from '../../core/lists';
import { targetFromNotification } from '../../core/deepLinks';
import { useBadgeCounts } from '../../hooks';
import { fmtDateTime } from '../../format';
import { Body, Button, Card } from '../../design/components';
import { BackgroundImage } from '../../design/BackgroundImage';
import { PagedList } from '../../design/PagedList';
import { Segmented } from '../../design/Segmented';
import { Text } from '../../design/Text';
import { bgImage } from '../../design/branding';
import { chipHeight, color, font, radius, space } from '../../design/tokens';
import { useCan, useUi } from '../../state/store';
import { openTarget } from '../../navigation/ref';

type Seg = 'notifications' | 'flags' | 'docs';
const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: chipHeight, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.control, borderWidth: 2, borderColor: color.asphalt, backgroundColor: on ? color.asphalt : color.paper }}>
    <Text style={{ fontFamily: font.bodyStrong, color: on ? color.paper : color.asphalt }}>{label}</Text>
  </Pressable>);

/** Notifications, flags (anomalies) and expiring documents in one place, for both roles. Was three separate screens. */
export function InboxScreen({ route, navigation }: any) {
  const { t } = useTranslation(); const [seg, setSeg] = useState<Seg>(route?.params?.initial ?? 'notifications'); const badges = useBadgeCounts();
  return (
    <BackgroundImage source={bgImage.admin}>
      <View style={{ flex: 1, backgroundColor: color.dust }}>
        <View style={{ padding: space.md, paddingBottom: 0 }}>
          <Segmented<Seg> value={seg} onChange={setSeg} options={[{ key: 'notifications', label: t('inbox.notifications'), badge: badges.unread }, { key: 'flags', label: t('inbox.flags'), badge: badges.anomalies }, { key: 'docs', label: t('inbox.docs') }]} />
        </View>
        {seg === 'notifications' ? <Notifications /> : seg === 'flags' ? <Flags navigation={navigation} /> : <Docs navigation={navigation} />}
      </View>
    </BackgroundImage>
  );
}

function Notifications() {
  const { t } = useTranslation(); const qc = useQueryClient(); const role = useUi((s) => s.activeRole);
  // `POST /notifications/{id}/read` and `/read-all` are gated on `notification:manage`, which only
  // ADMIN holds; `GET /notifications` needs `notification:read`, which DRIVER also holds. So a driver
  // gets the inbox WITHOUT the write actions, and nobody is sent a request the server will 403.
  const canManage = useCan('notification:manage');
  const l = useCursorList(['notifications'], url(ENDPOINTS.notifications), NotificationSchema, {}, { staleTime: 30_000, gcTime: 300_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const open = async (n: z.infer<typeof NotificationSchema>) => {
    // S-04: `payload` is the jsonb the backend stores; there is no `read_at`, read state is `status`.
    // Marking read needs `notification:manage`, which only ADMIN holds. A driver reading their inbox
    // is not offered the action, so nobody is sent a request the server will reject.
    if (isUnread(n) && canManage) { try { await api.post(url(ENDPOINTS.markRead, { id: n.id })); void refresh(); } catch { /* it stays unread and is retried on the next open */ } }
    const target = targetFromNotification(n.payload, role); if (target) openTarget(target, role);
  };
  return (
    <PagedList list={l} keyOf={(n) => n.id} empty={t('notifications.empty')}
      header={l.items.length && canManage ? <Button tone="quiet" label={t('notifications.markAllRead')} onPress={() => void api.post(url(ENDPOINTS.markAllRead)).then(refresh).catch(() => null)} /> : undefined}
      render={(n) => (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: isUnread(n) }} onPress={() => void open(n)}>
          <Card>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              {isUnread(n) ? <View accessibilityLabel={t('notifications.unread')} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color.verge }} /> : null}
              <Text style={{ fontFamily: isUnread(n) ? font.heading : font.body, fontSize: 17, color: color.asphalt, flex: 1 }}>{n.title}</Text>
            </View>
            <Body dim>{n.body}</Body><Body dim>{fmtDateTime(n.queued_at)}</Body>
          </Card>
        </Pressable>)} />
  );
}

function Flags({ navigation }: { navigation: any }) {
  const { t } = useTranslation(); const [domain, setDomain] = useState<string | null>(null);
  const l = useCursorList(['anomalies'], url(ENDPOINTS.anomalies), AnomalySchema, { domain: domain ?? undefined }, { staleTime: 30_000, gcTime: 300_000 });
  return (
    <PagedList list={l} keyOf={(a) => a.id} empty={t('anomalies.empty')}
      header={<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}><Chip label={t('anomalies.all')} on={!domain} onPress={() => setDomain(null)} />{ANOMALY_DOMAINS.map((d) => <Chip key={d} label={t(`anomalies.${d}`)} on={domain === d} onPress={() => setDomain(domain === d ? null : d)} />)}</View>}
      render={(a) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AnomalyDetail', { item: a })}>
          <Card><Text style={{ fontFamily: font.bodyStrong, color: a.severity === 'ALERT' ? color.brake : color.asphalt }}>{t(`anomalies.${a.severity}`, { defaultValue: a.severity })} · {t(`anomalies.${a.domain}`, { defaultValue: a.domain })}</Text><Body>{a.kind}</Body><Body dim>{fmtDateTime(a.detected_at)}</Body></Card>
        </Pressable>)} />
  );
}

function Docs({ navigation }: { navigation: any }) {
  const { t } = useTranslation(); const l = useCursorList(['expiring-docs'], url(ENDPOINTS.expiringDocs), DocumentSummarySchema, { within_days: 30 });
  return (
    <PagedList list={l} keyOf={(d) => d.document_id} empty={t('docs.empty')}
      render={(d) => (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('DocDetail', { item: d })}>
          <Card><Body>{d.linked_asset ?? d.subject_name ?? '—'} · {d.document_type}</Body><Text style={{ fontFamily: font.bodyStrong, color: (d.days_remaining ?? 99) <= 7 ? color.brake : color.asphalt }}>{(d.days_remaining ?? 0) < 0 ? t('docs.expired') : t('docs.days', { n: d.days_remaining ?? 0 })}</Text></Card>
        </Pressable>)} />
  );
}
