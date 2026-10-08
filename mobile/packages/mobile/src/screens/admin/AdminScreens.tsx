import React, { useState } from 'react';
import { ENDPOINTS, url, type Endpoint } from '../../api/endpoints';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { N5_ORDER, VehicleDetailSchema, cursorPage, type AnalyticsReport, type VehicleDisplayState, type CompanyAnalytics, type ManagerAnalytics } from '@fleet/shared';
import { api } from '../../services';
import { analyticsReportQuery, vehicleStatesQuery, useAnalyticsCompany } from '../../queries';
import { BADGE_PAGE_SIZE } from '../../core/policy';
import { fmtDateTime } from '../../format';
import { Body, Button, ErrorState, StatusBadge, Card, Title } from '../../design/components';
import { BackgroundImage } from '../../design/BackgroundImage';
import { Screen } from '../../design/Screen';
import { Skeleton } from '../../design/states';
import { Text } from '../../design/Text';
import { admin, chipHeight, color, font, phone, radius, space, statusColor, statusGlyph } from '../../design/tokens';
import { bgImage } from '../../design/branding';
import { goto } from '../../navigation/ref';
import { useUi } from '../../state/store';

function useFleet() {
  const socketUp = useUi((s) => s.socketUp);
  return useQuery({ ...vehicleStatesQuery, refetchInterval: socketUp ? false : 15_000 });   // REST fallback while the socket is down
}

/**
 * A tappable number card.
 *
 * S-08 partly resolved: `GET /reports/analytics` is the one endpoint that returns EXACT counts
 * (`open_accidents`, `pending_dvir`, `expiring_docs`, `anomalies_open`), so any card with a matching
 * field shows the real number. Everything else falls back to the first page size with a "+", and says
 * so in its accessibility label, so nobody reads a lower bound as a count.
 */
function CountCard({ label, endpoint, params, tone = 'normal', onPress, exact }: { label: string; endpoint: Endpoint; params?: Record<string, string | number | boolean>; tone?: 'normal' | 'urgent'; onPress: () => void; exact?: (r: AnalyticsReport) => number }) {
  const report = useQuery({ ...analyticsReportQuery, enabled: exact !== undefined });
  const q = useQuery({ queryKey: [endpoint.template.split('/')[1] ?? 'count', 'count', params], queryFn: () => api.get(url(endpoint), { query: { limit: BADGE_PAGE_SIZE, ...params }, schema: cursorPage(z.unknown()) }), staleTime: 30_000 });
  const true_ = exact && report.data ? String(exact(report.data)) : null;
  const n = true_ ?? (q.data ? `${q.data.data.length}${q.data.has_more ? '+' : ''}` : '–');
  const hasAny = true_ ? Number(true_) > 0 : !!q.data?.data.length;
  const hot = tone === 'urgent' && hasAny;
  const cardSpace = admin.space.md;
  const cardRadius = admin.radius.sheet;
  const minCardH = admin.type.display + admin.space.lg;
  return (
    <View style={{ flexBasis: 200, flexGrow: 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={true_ ? `${label}: ${n}` : `${label}: ${n} (at least)`} onPress={onPress} style={{ backgroundColor: hot ? color.brake : color.paper, borderRadius: cardRadius, padding: cardSpace, minHeight: minCardH, justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: font.bodyStrong, color: hot ? color.paper : color.mist, fontSize: admin.type.body }}>{label}</Text>
        <Text style={{ fontFamily: font.heading, fontSize: admin.type.display, color: hot ? color.paper : color.asphalt }}>{q.isLoading ? '…' : n}</Text>
      </Pressable>
    </View>
  );
}

/** Headline KPIs from `GET /analytics/company`, tappable to open the drill-down screen (C2.5). */
function AnalyticsKpisCard() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useAnalyticsCompany();
  if (isLoading) return null;
  if (error) return null;
  const k = data?.kpis;
  if (!k) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('dashDetail.title')}</Title>
        <Button tone="quiet" label={t('actions.REFRESH')} onPress={() => void refetch()} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: admin.space.sm }}>
        <Kpi label={t('dashDetail.distanceKm')} value={String(k.distanceKm)} />
        <Kpi label={t('dashDetail.fuelCost')} value={`KES ${k.fuelCost}`} />
        <Kpi label={t('dashDetail.anomalies')} value={String(k.anomalies)} />
        <Kpi label={t('dashDetail.vehicles')} value={String(k.vehicles)} />
        <Kpi label={t('dashDetail.drivers')} value={String(k.drivers)} />
      </View>
    </Card>
  );
}

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <View style={{ minWidth: 100, alignItems: 'center' }}>
    <Body dim style={{ fontSize: admin.type.caption }}>{label}</Body>
    <Title style={{ fontSize: admin.type.title }}>{value}</Title>
  </View>
);

/** Overview: what needs a person right now (urgent first), then the fleet's status at a glance. */
export function DashboardScreen() {
  const { t } = useTranslation(); const qc = useQueryClient(); const fleet = useFleet(); const [refreshing, setRefreshing] = useState(false);
  const counts = Object.fromEntries(N5_ORDER.map((s) => [s, 0])) as Record<VehicleDisplayState, number>; fleet.data?.vehicles.forEach((v) => { counts[v.display_state]++; });
  const refresh = async () => { setRefreshing(true); await qc.invalidateQueries(); setRefreshing(false); };
  return (
    <BackgroundImage source={bgImage.admin}>
      <Screen offlineTag refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Body dim style={{ fontSize: admin.type.body }}>{t('dash.attention')}</Body>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: admin.space.md }}>
          <CountCard tone="urgent" label={t('admin.accidents')} endpoint={ENDPOINTS.myAccidents} params={{ ownScope: false }} onPress={() => goto('Accidents')} exact={(r) => r.open_accidents} />
          <CountCard label={t('review.inspections')} endpoint={ENDPOINTS.inspections} params={{}} onPress={() => goto('Review', { segment: 'inspections' })} exact={(r) => r.pending_dvir} />
          <CountCard label={t('review.shifts')} endpoint={ENDPOINTS.shiftInbox} params={{ verification_status: 'PENDING', state: 'CLOSED' }} onPress={() => goto('Review', { segment: 'shifts' })} />
          <CountCard label={t('review.fuel')} endpoint={ENDPOINTS.fuelInbox} params={{ verified: false }} onPress={() => goto('Review', { segment: 'fuel' })} />
          <CountCard label={t('inbox.flags')} endpoint={ENDPOINTS.anomalies} onPress={() => goto('Inbox', { initial: 'flags' })} exact={(r) => r.anomalies_open} />
          <CountCard label={t('inbox.docs')} endpoint={ENDPOINTS.expiringDocs} params={{ within_days: 30 }} onPress={() => goto('Inbox', { initial: 'docs' })} exact={(r) => r.expiring_docs} />
        </View>
        <Body dim style={{ fontSize: admin.type.body }}>{t('dash.fleet')}</Body>
        {fleet.isLoading ? <Skeleton rows={2} height={64} /> : fleet.error ? <ErrorState code="UNKNOWN" onAction={() => void fleet.refetch()} /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: admin.space.md }}>
            {N5_ORDER.map((s) => <View key={s} style={{ flexBasis: 140, flexGrow: 1 }}><Pressable accessibilityRole="button" accessibilityLabel={`${t(`status.${s}`)}: ${counts[s]}`} onPress={() => goto('Map')}><Card><StatusBadge state={s} /><Title style={{ fontSize: admin.type.title }}>{String(counts[s])}</Title></Card></Pressable></View>)}
          </View>)}
        <AnalyticsKpisCard />
      </Screen>
    </BackgroundImage>
  );
}

/** Fleet map. The filter chips double as the legend: each shows the status glyph and name, never colour alone. */
export function LiveMapScreen() {
  const { t } = useTranslation(); const fleet = useFleet(); const [sel, setSel] = useState<string | null>(null); const [filter, setFilter] = useState<Set<string>>(new Set());
  const vehicles = (fleet.data?.vehicles ?? []).filter((v) => filter.size === 0 || filter.has(v.display_state)); const v = fleet.data?.vehicles.find((x) => x.vehicle_id === sel);
  const detail = useQuery({ queryKey: ['vehicle-detail', sel], enabled: !!sel, queryFn: () => api.get(url(ENDPOINTS.vehicle, { id: sel ?? '' }), { schema: VehicleDetailSchema }), retry: 0, staleTime: 30_000 });
  const toggle = (s: string) => setFilter((f) => { const n = new Set(f); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, backgroundColor: color.paper }} contentContainerStyle={{ padding: admin.space.sm, gap: admin.space.sm }}>
        {N5_ORDER.map((st) => {
          const on = filter.has(st);
          return (
            <Pressable key={st} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => toggle(st)} style={{ minHeight: admin.chipHeight, paddingHorizontal: admin.space.md, justifyContent: 'center', borderRadius: admin.radius.control, borderWidth: 2, borderColor: statusColor[st], backgroundColor: on ? statusColor[st] : color.paper }}>
              <Text style={{ fontFamily: font.bodyStrong, color: on ? color.paper : statusColor[st], fontSize: admin.type.body }}>{statusGlyph[st]} {t(`status.${st}`)}</Text>
            </Pressable>);
        })}
      </ScrollView>
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: -1.2921, longitude: 36.8219, latitudeDelta: 4, longitudeDelta: 4 }}>
        {vehicles.map((x) => x.latitude == null || x.longitude == null ? null : <Marker key={x.vehicle_id} tracksViewChanges={false} coordinate={{ latitude: x.latitude, longitude: x.longitude }} pinColor={statusColor[x.display_state]} onPress={() => setSel(x.vehicle_id)} />)}
      </MapView>
      {v ? (
        <ScrollView style={{ maxHeight: 280, backgroundColor: color.paper }} contentContainerStyle={{ padding: admin.space.md, gap: admin.space.sm }}>
          <StatusBadge state={v.display_state} /><Body style={{ fontSize: admin.type.body }}>{v.driver_name ?? v.vehicle_id}</Body>
          <Body dim style={{ fontSize: admin.type.body }}>{t('detail.position')}: {v.latitude != null && v.longitude != null ? `${v.latitude.toFixed(4)}, ${v.longitude.toFixed(4)}` : t('status.OFFLINE')}</Body>
          {v.next_eligible_clock_in_at ? <Body dim style={{ fontSize: admin.type.body }}>{t('detail.hos')}: {fmtDateTime(v.next_eligible_clock_in_at)}</Body> : null}
          {detail.data?.current_odometer_km != null ? <Body dim style={{ fontSize: admin.type.body }}>{t('shift.odometer')}: {detail.data.current_odometer_km}</Body> : null}
          {detail.data?.make || detail.data?.model ? <Body dim style={{ fontSize: admin.type.body }}>{[detail.data.make, detail.data.model].filter(Boolean).join(' ')}</Body> : null}
          {v.display_state === 'QUARANTINED' ? <Body style={{ fontSize: admin.type.body }}>{t('detail.quarantine')}: {detail.data?.non_operational_reason ?? t('signals.blockerDefect')}</Body> : null}
          <View style={{ flexDirection: 'row', gap: admin.space.sm }}><View style={{ flex: 1 }}><Button tone="quiet" label={t('admin.accidents')} onPress={() => goto('Accidents')} /></View><View style={{ flex: 1 }}><Button tone="quiet" label={t('review.inspections')} onPress={() => goto('Review', { segment: 'inspections' })} /></View></View>
        </ScrollView>) : null}
    </View>
  );
}
